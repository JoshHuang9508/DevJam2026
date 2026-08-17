import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyInstance } from "fastify";
import { jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { z, ZodError } from "zod";
import { agentEventSchema, type AgentEvent } from "./agent/events.js";
import { candidateSchema } from "./domain/candidates/schema.js";
import { preferencePatchSchema, preferenceStateSchema } from "./domain/preferences/schema.js";
import { searchSessionSchema } from "./domain/sessions/schema.js";
import type { AppConfig } from "./config/env.js";
import type { AgentService } from "./services/agent.service.js";
import type { PreferenceService } from "./services/preference.service.js";
import type { RecommendationService } from "./services/recommendation.service.js";
import { SessionNotFoundError, type SessionService } from "./services/session.service.js";

export interface AppDependencies {
  config: AppConfig;
  sessions: SessionService;
  preferences: PreferenceService;
  recommendations: RecommendationService;
  agent: AgentService;
  runtimeName: string;
}

const sessionParams = z.object({ id: z.string().uuid() });
const candidateParams = sessionParams.extend({ candidateId: z.string().min(1) });
const errorSchema = z.object({ error: z.string(), message: z.string(), requestId: z.string() });

export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.config.NODE_ENV === "test" ? false : { level: deps.config.LOG_LEVEL, redact: ["req.headers.authorization", "req.body.message"] },
    bodyLimit: deps.config.REQUEST_BODY_LIMIT,
    requestIdHeader: "x-request-id",
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(sensible);
  await app.register(cors, { origin: deps.config.CORS_ORIGINS.split(",").map((value) => value.trim()), credentials: true });
  await app.register(rateLimit, { max: deps.config.RATE_LIMIT_MAX, timeWindow: "1 minute" });
  await app.register(swagger, {
    openapi: {
      info: { title: "Taiwan Home Selector Agent API", version: "0.1.0", description: "Structured state is the source of truth. POST message supports JSON and text/event-stream." },
      tags: [{ name: "sessions" }, { name: "agent" }, { name: "recommendations" }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.get("/health", { schema: { response: { 200: z.object({ status: z.literal("ok"), runtime: z.string() }) } } }, async () => ({ status: "ok" as const, runtime: deps.runtimeName }));
  app.get("/openapi.json", { schema: { hide: true } }, async () => app.swagger());

  app.post("/sessions", {
    schema: {
      tags: ["sessions"],
      body: z.object({ userId: z.string().max(200).nullable().optional() }).default({}),
      response: { 201: searchSessionSchema, 400: errorSchema },
    },
  }, async (request, reply) => reply.code(201).send(await deps.sessions.create(request.body.userId ?? null)));

  app.get("/sessions/:id", { schema: { tags: ["sessions"], params: sessionParams, response: { 200: searchSessionSchema, 404: errorSchema } } }, async (request) => deps.sessions.get(request.params.id));
  app.get("/sessions/:id/preferences", { schema: { tags: ["sessions"], params: sessionParams, response: { 200: preferenceStateSchema, 404: errorSchema } } }, async (request) => (await deps.sessions.get(request.params.id)).preferences);

  app.patch("/sessions/:id/preferences", {
    schema: {
      tags: ["sessions", "recommendations"],
      description: "Deep-merges the single persistent preference state and automatically reranks candidates.",
      params: sessionParams,
      body: preferencePatchSchema,
      response: { 200: z.object({ preferences: preferenceStateSchema, candidates: z.array(candidateSchema) }), 400: errorSchema, 404: errorSchema },
    },
  }, async (request) => {
    const updated = await deps.preferences.update(request.params.id, request.body);
    const candidates = updated.candidates.length ? await deps.recommendations.rerank(updated.id) : await deps.recommendations.searchAndRank(updated.id);
    return { preferences: (await deps.sessions.get(updated.id)).preferences, candidates };
  });

  app.get("/sessions/:id/candidates", { schema: { tags: ["recommendations"], params: sessionParams, response: { 200: z.array(candidateSchema), 404: errorSchema } } }, async (request) => (await deps.sessions.get(request.params.id)).candidates);
  app.get("/sessions/:id/candidates/:candidateId", { schema: { tags: ["recommendations"], params: candidateParams, response: { 200: candidateSchema, 404: errorSchema } } }, async (request, reply) => {
    const candidate = await deps.recommendations.getCandidate(request.params.id, request.params.candidateId);
    if (!candidate) return reply.notFound("Candidate was not found in this session");
    return candidate;
  });
  app.post("/sessions/:id/rank", { schema: { tags: ["recommendations"], params: sessionParams, body: z.object({ refreshData: z.boolean().default(true) }).default({ refreshData: true }), response: { 200: z.object({ candidates: z.array(candidateSchema) }), 404: errorSchema } } }, async (request) => ({ candidates: request.body.refreshData ? await deps.recommendations.searchAndRank(request.params.id) : await deps.recommendations.rerank(request.params.id) }));

  app.post("/sessions/:id/messages", {
    schema: {
      tags: ["agent"],
      summary: "Run one multi-turn agent message",
      description: "Set Accept: text/event-stream for typed SSE events: message.started/delta/completed, tool.started/completed, preferences.updated, candidates.updated, ranking.updated, error. Without SSE, returns the collected event array.",
      params: sessionParams,
      body: z.object({ message: z.string().min(1).max(4_000) }),
      response: { 200: z.object({ events: z.array(agentEventSchema), session: searchSessionSchema }), 404: errorSchema },
    },
  }, async (request, reply) => {
    const wantsSse = request.headers.accept?.includes("text/event-stream") === true;
    if (!wantsSse) {
      const events: AgentEvent[] = [];
      for await (const event of deps.agent.runTurn(request.params.id, request.body.message)) events.push(event);
      return { events, session: await deps.sessions.get(request.params.id) };
    }
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const abortController = new AbortController();
    reply.raw.once("close", () => abortController.abort());
    try {
      for await (const event of deps.agent.runTurn(request.params.id, request.body.message, abortController.signal)) {
        reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error) {
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ type: "error", code: "MESSAGE_FAILED", message: error instanceof Error ? error.message : String(error), recoverable: false })}\n\n`);
    } finally {
      reply.raw.end();
    }
  });

  app.setErrorHandler((error, request, reply) => {
    const typedError = error as { validation?: unknown; statusCode?: number; message?: string };
    const status = error instanceof SessionNotFoundError ? 404 : error instanceof ZodError || Boolean(typedError.validation) ? 400 : typedError.statusCode && typedError.statusCode < 500 ? typedError.statusCode : 500;
    if (status >= 500) request.log.error({ err: error, requestId: request.id }, "request failed");
    reply.code(status).send({ error: status === 404 ? "NOT_FOUND" : status === 400 ? "VALIDATION_ERROR" : "INTERNAL_ERROR", message: status >= 500 ? "Internal server error" : typedError.message ?? "Request failed", requestId: request.id });
  });
  app.addHook("onClose", async () => deps.sessions.close());
  return app;
}
