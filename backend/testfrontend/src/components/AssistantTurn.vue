<script setup lang="ts">
import MarkdownRender from "markstream-vue";
import type { AssistantChat } from "@/lib/types";
import JsonBlock from "./JsonBlock.vue";

defineProps<{ turn: AssistantChat }>();
</script>

<template>
  <article class="bubble assistant">
    <header class="bubble-head">
      <span class="who">Agent</span>
      <span v-if="turn.model" class="meta">{{ turn.model }}</span>
      <span v-if="turn.usage" class="meta">
        in {{ turn.usage.input }} / out {{ turn.usage.output }} / ${{ turn.usage.costUsd.toFixed(4) }}
      </span>
      <span v-if="!turn.done" class="pulse">streaming</span>
    </header>

    <div v-for="block in turn.blocks" :key="block.id" class="block">
      <details v-if="block.kind === 'thinking'" class="thinking" :open="!block.done || turn.blocks.length === 1">
        <summary>思考{{ block.done ? "" : "中…" }}</summary>
        <pre class="thinking-body">{{ block.text || "…" }}</pre>
      </details>

      <section v-else-if="block.kind === 'tool'" class="tool" :data-status="block.status">
        <header>
          <span class="tool-name">{{ block.toolName }}</span>
          <span class="tool-status">{{ block.status }}</span>
          <span v-if="block.durationMs != null" class="meta">{{ block.durationMs }}ms</span>
        </header>
        <JsonBlock :value="block.arguments" label="arguments" />
        <JsonBlock v-if="block.status !== 'running'" :value="block.result" :label="block.isError ? 'error result' : 'result'" :open="block.isError" />
      </section>

      <div v-else class="answer">
        <MarkdownRender
          mode="chat"
          :content="block.text"
          :final="block.done"
          :fade="false"
          :custom-html-tags="['thinking']"
        />
      </div>
    </div>

    <p v-if="turn.error" class="error">{{ turn.error }}</p>
  </article>
</template>
