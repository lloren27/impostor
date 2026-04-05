<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'

const props = defineProps<{
  file: string
}>()

const markdownFiles = import.meta.glob('@/content/seo/*.md', {
  query: '?raw',
  import: 'default',
})

const html = ref('')

const filePath = computed(() => `/src/content/seo/${props.file}`)

function escapeHtml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function parseInlineMarkdown(text: string) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
}

function markdownToHtml(markdown: string) {
  const lines = markdown.split('\n')
  const output: string[] = []

  let inList = false

  for (const rawLine of lines) {
    const line = rawLine.trim()

    if (!line) {
      if (inList) {
        output.push('</ul>')
        inList = false
      }
      continue
    }

    if (line.startsWith('### ')) {
      if (inList) {
        output.push('</ul>')
        inList = false
      }
      output.push(`<h3>${parseInlineMarkdown(escapeHtml(line.slice(4)))}</h3>`)
      continue
    }

    if (line.startsWith('## ')) {
      if (inList) {
        output.push('</ul>')
        inList = false
      }
      output.push(`<h2>${parseInlineMarkdown(escapeHtml(line.slice(3)))}</h2>`)
      continue
    }

    if (line.startsWith('# ')) {
      if (inList) {
        output.push('</ul>')
        inList = false
      }
      output.push(`<h1>${parseInlineMarkdown(escapeHtml(line.slice(2)))}</h1>`)
      continue
    }

    if (line.startsWith('- ')) {
      if (!inList) {
        output.push('<ul>')
        inList = true
      }
      output.push(`<li>${parseInlineMarkdown(escapeHtml(line.slice(2)))}</li>`)
      continue
    }

    if (inList) {
      output.push('</ul>')
      inList = false
    }

    output.push(`<p>${parseInlineMarkdown(escapeHtml(line))}</p>`)
  }

  if (inList) {
    output.push('</ul>')
  }

  return output.join('\n')
}

watchEffect(async () => {
  const loader = markdownFiles[filePath.value]

  if (!loader) {
    html.value = '<p>No se ha encontrado el contenido.</p>'
    return
  }

  const markdown = (await loader()) as string
  html.value = markdownToHtml(markdown)
})
</script>

<template>
  <article class="seo-content-rendered" v-html="html" />
</template>

<style scoped>
.seo-content-rendered {
  max-width: 860px;
  margin: 0 auto;
  line-height: 1.7;
  color: #d1d5db;
}

.seo-content-rendered :deep(h1),
.seo-content-rendered :deep(h2),
.seo-content-rendered :deep(h3) {
  color: #f3f4f6;
  line-height: 1.2;
  margin-top: 1.75rem;
  margin-bottom: 0.75rem;
}

.seo-content-rendered :deep(h1) {
  font-size: 2rem;
}

.seo-content-rendered :deep(h2) {
  font-size: 1.5rem;
}

.seo-content-rendered :deep(h3) {
  font-size: 1.15rem;
}

.seo-content-rendered :deep(p) {
  margin: 0 0 1rem;
}

.seo-content-rendered :deep(ul) {
  margin: 0 0 1rem 1.25rem;
  padding: 0;
}

.seo-content-rendered :deep(li) {
  margin-bottom: 0.5rem;
}

.seo-content-rendered :deep(strong) {
  color: #f9fafb;
}

.seo-content-rendered :deep(code) {
  padding: 0.1rem 0.35rem;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  font-size: 0.95em;
}
</style>
