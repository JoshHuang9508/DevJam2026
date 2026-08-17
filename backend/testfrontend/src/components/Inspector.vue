<script setup lang="ts">
import { computed, ref } from "vue";
import type { LoggedEvent, SearchSession } from "@/lib/types";
import JsonBlock from "./JsonBlock.vue";

const props = defineProps<{
  session: SearchSession | null;
  events: LoggedEvent[];
  loading?: boolean;
}>();

const emit = defineEmits<{ refresh: [] }>();
const tab = ref<"db" | "events">("db");

const prefs = computed(() => props.session?.preferences ?? null);
const candidates = computed(() => props.session?.candidates ?? []);
const history = computed(() => props.session?.rankingHistory ?? []);
const conversation = computed(() => props.session?.conversation ?? []);
</script>

<template>
  <aside class="inspector">
    <div class="inspector-tabs">
      <button :class="{ on: tab === 'db' }" type="button" @click="tab = 'db'">資料庫</button>
      <button :class="{ on: tab === 'events' }" type="button" @click="tab = 'events'">SSE 事件</button>
      <button class="ghost" type="button" :disabled="loading || !session" @click="emit('refresh')">重新讀取</button>
    </div>

    <div v-if="tab === 'db'" class="inspector-body">
      <p v-if="!session" class="empty">還沒有 session。</p>
      <template v-else>
        <section class="card">
          <h3>search_sessions</h3>
          <dl class="kv">
            <dt>id</dt><dd>{{ session.id }}</dd>
            <dt>user_id</dt><dd>{{ session.userId ?? "null" }}</dd>
            <dt>created_at</dt><dd>{{ session.createdAt }}</dd>
            <dt>updated_at</dt><dd>{{ session.updatedAt }}</dd>
            <dt>preference version</dt><dd>{{ (prefs as { version?: number } | null)?.version ?? "—" }}</dd>
          </dl>
        </section>

        <section class="card">
          <h3>preferences</h3>
          <JsonBlock :value="prefs" label="JSONB" open />
        </section>

        <section class="card">
          <h3>conversation_messages ({{ conversation.length }})</h3>
          <ol v-if="conversation.length" class="msg-list">
            <li v-for="message in conversation" :key="message.id">
              <strong>{{ message.role }}</strong>
              <span class="meta">{{ message.createdAt }}</span>
              <pre>{{ message.content }}</pre>
            </li>
          </ol>
          <p v-else class="empty">空</p>
        </section>

        <section class="card">
          <h3>candidates ({{ candidates.length }})</h3>
          <table v-if="candidates.length" class="grid">
            <thead>
              <tr>
                <th>#</th>
                <th>行政區</th>
                <th>分數</th>
                <th>信心</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(candidate, index) in candidates" :key="candidate.id">
                <td>{{ index + 1 }}</td>
                <td>{{ candidate.city }}{{ candidate.district }}</td>
                <td>{{ candidate.score }}</td>
                <td>{{ candidate.confidence }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="empty">尚未排名</p>
          <JsonBlock v-if="candidates.length" :value="candidates" label="完整 candidates JSONB" />
        </section>

        <section class="card">
          <h3>ranking_snapshots ({{ history.length }})</h3>
          <div v-for="snap in history" :key="snap.id" class="snap">
            <p>
              v{{ snap.preferenceVersion }} · {{ snap.candidates.length }} 筆 · {{ snap.createdAt }}
            </p>
            <JsonBlock :value="snap" :label="snap.id" />
          </div>
          <p v-if="!history.length" class="empty">沒有快照</p>
        </section>
      </template>
    </div>

    <div v-else class="inspector-body">
      <p v-if="!events.length" class="empty">送出一則訊息後，這裡會列出每一個 SSE event。</p>
      <article v-for="item in events" :key="item.id" class="event">
        <header>
          <span class="etype">{{ item.event.type }}</span>
          <span class="meta">{{ item.receivedAt }}</span>
        </header>
        <JsonBlock :value="item.event" label="payload" />
      </article>
    </div>
  </aside>
</template>
