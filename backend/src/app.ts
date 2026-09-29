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
import { urbanPlanCitySchema, urbanPlanReportSchema } from "./domain/urban-plan/schema.js";
import { UrbanPlanCoverageError } from "./providers/urban-plan/index.js";
import type { UrbanPlanProvider } from "./providers/urban-plan/types.js";
import type { AppConfig } from "./config/env.js";
import type { ListingsProvider, SearchProfile } from "./providers/listings/index.js";
import { ingestListingSchema, type ListingIngestion } from "./database/listing-ingestion.js";
import type { GeocodingService } from "./geocoding/service.js";
import { enrichmentSourceSchema, type EnrichmentService } from "./enrichment/service.js";
import { rawSourceSchema, type PipelineService } from "./pipeline/service.js";
import type { AgentService } from "./services/agent.service.js";
import { asProviderProfile, toPreferencePatch, toUiSearchProfile, uiSearchProfileSchema, type UiSearchProfile } from "./presentation/profile.js";
import type { PreferenceService } from "./services/preference.service.js";
import type { RecommendationService } from "./services/recommendation.service.js";
import { SessionNotFoundError, type SessionService } from "./services/session.service.js";

export interface AppDependencies {
  config: AppConfig;
  sessions: SessionService;
  preferences: PreferenceService;
  recommendations: RecommendationService;
  agent: AgentService;
  urbanPlan: UrbanPlanProvider;
  listings: ListingsProvider;
  ingestion: ListingIngestion;
  geocoding: GeocodingService;
  enrichment: EnrichmentService;
  pipeline: PipelineService;
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
      tags: [{ name: "sessions" }, { name: "agent" }, { name: "recommendations" }, { name: "urban-plan" }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.get("/health", { schema: { response: { 200: z.object({ status: z.literal("ok"), runtime: z.string() }) } } }, async () => ({ status: "ok" as const, runtime: deps.runtimeName }));
  app.get("/listings/status", { config: { rateLimit: false } }, async () => ({ available: await deps.listings.available(), total: await deps.listings.count() }));
  app.get("/listings/rows", { config: { rateLimit: false }, schema: { querystring: z.object({ mode: z.enum(["sale", "rent"]) }) } }, async (request, reply) => {
    if (!(await deps.listings.available())) return reply.serviceUnavailable("物件資料庫尚未建立");
    return deps.listings.rows(request.query.mode);
  });
  app.get("/listings/districts", { config: { rateLimit: false } }, async (_request, reply) => {
    if (!(await deps.listings.available())) return reply.serviceUnavailable("物件資料庫尚未建立");
    return deps.listings.districts();
  });
  app.post("/listings/pool", { config: { rateLimit: false }, schema: { body: z.object({ mode: z.enum(["sale", "rent"]), cities: z.array(z.string()).default([]) }) } }, async (request, reply) => {
    if (!(await deps.listings.available())) return reply.serviceUnavailable("物件資料庫尚未建立");
    const profile: SearchProfile = { mode: request.body.mode, weights: { price: 50, value: 50, weather: 50, location: 50, amenities: 50, space: 50, quality: 50, hazard: 50 }, hard: { cities: request.body.cities } };
    return (await deps.listings.search(profile, "", 500)).results.map((listing) => ({ ...listing, ...listing.features, features: undefined }));
  });
  app.post("/listings/search", {
    config: { rateLimit: false },
    schema: { body: z.object({ profile: z.object({ mode: z.enum(["sale", "rent"]), weights: z.record(z.string(), z.number()), hard: z.record(z.string(), z.unknown()), soft: z.record(z.string(), z.unknown()).optional(), notes: z.array(z.string()).optional() }), semanticQuery: z.string().max(4_000).optional(), limit: z.number().int().min(1).max(500).optional() }) },
  }, async (request, reply) => {
    if (!(await deps.listings.available())) return reply.serviceUnavailable("物件向量資料庫尚未建立");
    const semanticQuery = request.body.semanticQuery ?? request.body.profile.notes?.join(" ") ?? "";
    return deps.listings.search(request.body.profile as SearchProfile, semanticQuery, request.body.limit ?? 100, request.signal);
  });
  app.post("/listings/ingest", {
    config: { rateLimit: false },
    schema: { body: z.object({ runId: z.string().uuid(), items: z.array(ingestListingSchema).min(1).max(50) }) },
  }, async (request) => deps.ingestion.ingest(request.body.runId, request.body.items, request.signal));
  app.post("/listings/ingest/complete", {
    config: { rateLimit: false },
    schema: { body: z.object({ runId: z.string().uuid(), source: z.string().min(1) }) },
  }, async (request) => deps.ingestion.complete(request.body.runId, request.body.source));
  app.post("/geocoding/lookup", {
    config: { rateLimit: false },
    schema: { body: z.object({ runId: z.string().uuid(), addresses: z.array(z.string().min(1)).min(1).max(50) }) },
  }, async (request) => ({ results: await deps.geocoding.lookup(request.body.runId, request.body.addresses, request.signal) }));
  app.post("/geocoding/complete", {
    config: { rateLimit: false },
    schema: { body: z.object({ runId: z.string().uuid() }) },
  }, async (request) => { deps.geocoding.complete(request.body.runId); return { completed: true }; });
  app.get("/enrichment/sources", { config: { rateLimit: false } }, async () => deps.enrichment.sources());
  app.put("/enrichment/sources/:id", {
    config: { rateLimit: false },
    schema: { params: z.object({ id: z.string().min(1) }), body: enrichmentSourceSchema.omit({ id: true }) },
  }, async (request) => deps.enrichment.saveSource({ id: request.params.id, ...request.body }));
  app.post("/enrichment/run", {
    config: { rateLimit: false },
    schema: { body: z.object({ sourceIds: z.array(z.string()).optional(), listingIds: z.array(z.string()).optional(), limit: z.number().int().min(1).max(100).default(20) }).default({ limit: 20 }) },
  }, async (request) => deps.enrichment.run(request.body, request.signal));
  app.get("/pipeline/sources", { config: { rateLimit: false } }, async () => deps.pipeline.sources());
  app.put("/pipeline/sources/:id", {
    config: { rateLimit: false },
    schema: { params: z.object({ id: z.string().min(1) }), body: rawSourceSchema.omit({ id: true }) },
  }, async (request) => deps.pipeline.saveSource({ id: request.params.id, ...request.body }));
  app.get("/pipeline/jobs", {
    config: { rateLimit: false },
    schema: { querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }) },
  }, async (request) => deps.pipeline.jobs(request.query.limit));
  app.post("/pipeline/run", {
    config: { rateLimit: false },
    schema: { body: z.object({ sourceIds: z.array(z.string()).optional() }).default({}) },
  }, async (request) => deps.pipeline.run(request.body, request.signal));
  app.post("/ui/chat", {
    config: { rateLimit: false },
    schema: { body: z.object({ sessionId: z.string().uuid().optional(), profile: uiSearchProfileSchema, message: z.string().trim().min(1).max(4_000) }) },
  }, async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const send = (event: string, data: unknown) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const message = request.body.message;
    const clientProfile = request.body.profile;
    let sessionId = request.body.sessionId;
    const emitResults = async (profile: UiSearchProfile) => {
      const nextProfile = { ...profile, notes: [...new Set([message, ...profile.notes])].slice(0, 10) };
      const ranked = await deps.listings.search(asProviderProfile(nextProfile), nextProfile.notes.join(" "), 100, request.signal);
      send("profile", nextProfile);
      send("results", { results: ranked.results, relaxations: ranked.relaxations });
    };
    try {
      if (!sessionId) sessionId = (await deps.sessions.create()).id;
      try {
        await deps.preferences.update(sessionId, toPreferencePatch(clientProfile));
      } catch (error) {
        if (!(error instanceof SessionNotFoundError)) throw error;
        sessionId = (await deps.sessions.create()).id;
        await deps.preferences.update(sessionId, toPreferencePatch(clientProfile));
      }
      send("session", { sessionId });
      let emittedResults = false;
      let sawText = false;
      for await (const event of deps.agent.runTurn(sessionId, message, request.signal)) {
        if (event.type === "preferences.updated") {
          await emitResults(toUiSearchProfile(event.preferences, clientProfile));
          emittedResults = true;
        } else if (event.type === "listings.ranked") {
          const parsed = uiSearchProfileSchema.safeParse(event.effectiveProfile);
          const effective = parsed.success ? parsed.data : clientProfile;
          send("profile", { ...effective, notes: [...new Set([message, ...clientProfile.notes])].slice(0, 10) });
          send("results", { results: event.results, relaxations: [] });
          emittedResults = true;
        } else if (event.type === "message.delta") {
          sawText = true;
          send("text", { delta: event.delta });
        } else if (event.type === "message.completed" && !sawText && event.message) {
          send("text", { delta: event.message });
        } else if (event.type === "error") {
          send("error", { message: event.message });
        }
      }
      if (!emittedResults) await emitResults(clientProfile);
      send("done", {});
    } catch (error) {
      request.log.error({ err: error }, "ui chat failed");
      send("error", { message: error instanceof Error ? error.message : "伺服器連接錯誤。" });
      send("done", {});
    } finally {
      reply.raw.end();
    }
  });
  app.get("/openapi.json", { schema: { hide: true } }, async () => app.swagger());

  app.post("/urban-plan", {
    schema: {
      tags: ["urban-plan"],
      summary: "以 WGS84 座標查都市計畫使用分區",
      description: [
        "直接查臺北市 UPIS、新北市城鄉資訊查詢平台、基隆市 UPGIS 三個官方圖資系統，回傳使用分區、建蔽率、容積率、所屬都市計畫與管制範圍。",
        "match=parcel 才是該座標所在分區圖形；nearby 是周邊參考值（座標落在道路、河川等無分區圖形處）；none 為查無資料。",
        "結果會快取；基隆市圖資的回應時間不穩定，偶爾單次查詢會需要 20 秒以上。",
      ].join(" "),
      body: z.object({
        latitude: z.number().min(20).max(27),
        longitude: z.number().min(118).max(123),
        city: urbanPlanCitySchema.optional(),
      }),
      response: { 200: urbanPlanReportSchema, 400: errorSchema },
    },
  }, async (request, reply) => {
    const { latitude, longitude, city } = request.body;
    try {
      return await deps.urbanPlan.lookup({ latitude, longitude, ...(city ? { city } : {}) });
    } catch (error) {
      if (error instanceof UrbanPlanCoverageError) return reply.badRequest(error.message);
      throw error;
    }
  });

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
    return { preferences: updated.preferences, candidates: updated.candidates };
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
  app.addHook("onClose", async () => {
    await deps.pipeline.close();
    await Promise.all([deps.sessions.close(), deps.listings.close(), deps.ingestion.close(), deps.geocoding.close(), deps.enrichment.close()]);
  });
  return app;
}
