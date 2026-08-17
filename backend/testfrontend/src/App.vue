<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import AssistantTurn from "./components/AssistantTurn.vue";
import Inspector from "./components/Inspector.vue";
import { BackendError, createSession, getHealth, getSession, openMessageStream } from "./lib/api";
import { emptyAssistant, sessionToChat, uid } from "./lib/session-chat";
import { readAgentEvents } from "./lib/sse";
import type { AgentEvent, AssistantChat, ChatItem, LoggedEvent, SearchSession, TextBlock, ThinkingBlock } from "./lib/types";

const SESSION_KEY = "agent-lab.sessionId";

const health = ref<{ ok: boolean; runtime: string } | null>(null);
const session = ref<SearchSession | null>(null);
const sessionInput = ref("");
const chat = ref<ChatItem[]>([]);
const events = ref<LoggedEvent[]>([]);
const input = ref("");
const sending = ref(false);
const loadingSession = ref(false);
const error = ref("");
const chatEl = ref<HTMLElement | null>(null);
let abort: AbortController | null = null;

onMounted(() => {
  void boot();
});

async function boot() {
  await ping();
  const stored = localStorage.getItem(SESSION_KEY);
  if (stored) {
    sessionInput.value = stored;
    try {
      await loadSession(stored);
      return;
    } catch {
      localStorage.removeItem(SESSION_KEY);
    }
  }
  await newSession();
}

async function ping() {
  try {
    const result = await getHealth();
    health.value = { ok: true, runtime: result.runtime };
  } catch {
    health.value = { ok: false, runtime: "offline" };
  }
}

async function newSession() {
  loadingSession.value = true;
  error.value = "";
  try {
    const created = await createSession();
    applySession(created);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loadingSession.value = false;
  }
}

async function loadSession(id: string) {
  loadingSession.value = true;
  error.value = "";
  try {
    applySession(await getSession(id.trim()));
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    loadingSession.value = false;
  }
}

function applySession(next: SearchSession) {
  session.value = next;
  sessionInput.value = next.id;
  chat.value = sessionToChat(next);
  localStorage.setItem(SESSION_KEY, next.id);
  void scrollChat();
}

async function refreshSession() {
  if (!session.value) return;
  loadingSession.value = true;
  try {
    session.value = await getSession(session.value.id);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loadingSession.value = false;
  }
}

function currentAssistant(turnId: string): AssistantChat {
  const last = chat.value[chat.value.length - 1];
  if (last?.kind === "assistant" && last.turnId === turnId) return last;
  const created = emptyAssistant(turnId);
  chat.value.push(created);
  return created;
}

function applyEvent(event: AgentEvent) {
  events.value.push({ id: uid("evt"), receivedAt: new Date().toISOString(), event });
  const turn = currentAssistant(event.turnId);
  if (event.type === "thinking.started") {
    turn.blocks.push({ kind: "thinking", id: uid("th"), text: "", done: false });
  } else if (event.type === "thinking.delta") {
    const block = lastOf(turn, "thinking") ?? pushThinking(turn);
    block.text += event.delta;
  } else if (event.type === "thinking.completed") {
    const block = lastOf(turn, "thinking") ?? pushThinking(turn);
    if (event.thinking) block.text = event.thinking;
    block.done = true;
  } else if (event.type === "tool.started") {
    turn.blocks.push({
      kind: "tool",
      id: event.toolCallId,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      arguments: event.arguments,
      status: "running",
    });
  } else if (event.type === "tool.completed") {
    const block = turn.blocks.find((item) => item.kind === "tool" && item.toolCallId === event.toolCallId);
    if (block && block.kind === "tool") {
      block.status = event.isError ? "error" : "done";
      block.isError = event.isError;
      block.durationMs = event.durationMs;
      block.result = event.result;
    }
  } else if (event.type === "message.delta") {
    const block = lastOf(turn, "text") ?? pushText(turn);
    block.text += event.delta;
  } else if (event.type === "message.completed") {
    const block = lastOf(turn, "text") ?? pushText(turn);
    if (event.message) block.text = event.message;
    block.done = true;
    turn.model = event.model;
    turn.usage = event.usage;
  } else if (event.type === "preferences.updated" && session.value) {
    session.value = { ...session.value, preferences: event.preferences };
  } else if ((event.type === "candidates.updated" || event.type === "ranking.updated") && session.value) {
    session.value = { ...session.value, candidates: event.candidates };
  } else if (event.type === "error") {
    turn.error = `${event.code}: ${event.message}`;
  }
}

function lastOf<K extends AssistantChat["blocks"][number]["kind"]>(turn: AssistantChat, kind: K) {
  const block = [...turn.blocks].reverse().find((item) => item.kind === kind);
  return (block?.kind === kind ? block : undefined) as Extract<AssistantChat["blocks"][number], { kind: K }> | undefined;
}

function pushThinking(turn: AssistantChat): ThinkingBlock {
  const block: ThinkingBlock = { kind: "thinking", id: uid("th"), text: "", done: false };
  turn.blocks.push(block);
  return block;
}

function pushText(turn: AssistantChat): TextBlock {
  const block: TextBlock = { kind: "text", id: uid("text"), text: "", done: false };
  turn.blocks.push(block);
  return block;
}

async function send() {
  const message = input.value.trim();
  if (!message || !session.value || sending.value) return;
  abort?.abort();
  abort = new AbortController();
  sending.value = true;
  error.value = "";
  input.value = "";
  chat.value.push({ kind: "user", id: uid("user"), content: message, createdAt: new Date().toISOString() });
  await scrollChat();
  try {
    const response = await openMessageStream(session.value.id, message, abort.signal);
    for await (const event of readAgentEvents(response.body!, abort.signal)) {
      applyEvent(event);
      await scrollChat();
    }
    const last = chat.value[chat.value.length - 1];
    if (last?.kind === "assistant") {
      last.done = true;
      last.blocks.forEach((block) => {
        if (block.kind !== "tool") block.done = true;
      });
    }
    await refreshSession();
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    const last = chat.value[chat.value.length - 1];
    const text = err instanceof BackendError ? err.message : err instanceof Error ? err.message : String(err);
    if (last?.kind === "assistant") {
      last.error = text;
      last.done = true;
    } else {
      error.value = text;
    }
  } finally {
    sending.value = false;
    abort = null;
  }
}

function stop() {
  abort?.abort();
  abort = null;
  sending.value = false;
  const last = chat.value[chat.value.length - 1];
  if (last?.kind === "assistant") last.done = true;
}

function onKey(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void send();
  }
}

async function onLoadSession() {
  if (!sessionInput.value.trim()) return;
  events.value = [];
  await loadSession(sessionInput.value);
}

async function onNewSession() {
  events.value = [];
  await newSession();
}

async function scrollChat() {
  await nextTick();
  if (chatEl.value) chatEl.value.scrollTop = chatEl.value.scrollHeight;
}
</script>

<template>
  <div class="app">
    <header class="top">
      <div class="brand">
        <strong>Agent Lab</strong>
        <span class="meta">markstream-vue · 直連 backend</span>
      </div>
      <div class="status" :data-ok="health?.ok === true">
        {{ health?.ok ? health.runtime : health ? "backend offline" : "checking…" }}
      </div>
      <label class="sid">
        session
        <input v-model="sessionInput" spellcheck="false" @keydown.enter.prevent="onLoadSession" />
      </label>
      <button type="button" :disabled="loadingSession" @click="onLoadSession">載入</button>
      <button type="button" :disabled="loadingSession" @click="onNewSession">新 session</button>
    </header>

    <p v-if="error" class="banner">{{ error }}</p>

    <main class="split">
      <section class="chat-col">
        <div ref="chatEl" class="transcript">
          <p v-if="!chat.length" class="empty">對 agent 提問。思考、tool_use、回答會即時出現；右邊是 Postgres 裡這個 session 的狀態。</p>
          <template v-for="item in chat" :key="item.id">
            <article v-if="item.kind === 'user'" class="bubble user">
              <header class="bubble-head"><span class="who">你</span></header>
              <p class="user-text">{{ item.content }}</p>
            </article>
            <AssistantTurn v-else :turn="item" />
          </template>
        </div>
        <form class="composer" @submit.prevent="send">
          <textarea
            v-model="input"
            rows="3"
            placeholder="例如：我想在台北捷運沿線租屋，預算 2 萬，在意通勤和生活機能"
            :disabled="!session || loadingSession"
            @keydown="onKey"
          />
          <div class="composer-actions">
            <button v-if="sending" type="button" @click="stop">停止</button>
            <button v-else type="submit" :disabled="!input.trim() || !session">送出</button>
          </div>
        </form>
      </section>
      <Inspector :session="session" :events="events" :loading="loadingSession" @refresh="refreshSession" />
    </main>
  </div>
</template>
