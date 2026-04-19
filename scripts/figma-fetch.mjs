#!/usr/bin/env node
/**
 * Fetch Figma file or node JSON via REST API (token stays in .env — not exposed to the browser).
 *
 * Usage:
 *   npm run figma:fetch -- <fileKey> [nodeId ...]
 *   npm run figma:fetch -- --url "https://www.figma.com/design/FILE_KEY/Name?node-id=1-2"
 *
 * Env:
 *   FIGMA_TOKEN   Personal access token (Settings → Security in Figma)
 *
 * Node IDs in URLs use dashes (1-2); the API expects colons (1:2). This script accepts both.
 */

import 'dotenv/config'
import { writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'

const FIGMA_API = 'https://api.figma.com/v1'

/** Figma URLs use node-id=123-456; the API expects 123:456 (first hyphen → colon). */
function normalizeNodeId(raw) {
  const s = String(raw).trim()
  if (!s) return ''
  if (s.includes(':')) return s
  const i = s.indexOf('-')
  if (i === -1) return s
  return `${s.slice(0, i)}:${s.slice(i + 1)}`
}

function parseFigmaUrl(url) {
  try {
    const u = new URL(url)
    const path = u.pathname
    const m = path.match(/\/(?:design|file)\/([^/]+)/)
    const fileKey = m?.[1] ?? ''
    const nodeParam = u.searchParams.get('node-id') ?? ''
    const nodeId = nodeParam ? normalizeNodeId(nodeParam) : ''
    return { fileKey, nodeId }
  } catch {
    return { fileKey: '', nodeId: '' }
  }
}

function buildHeaders(token) {
  return {
    'X-Figma-Token': token,
    Accept: 'application/json',
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      url: { type: 'string', short: 'u' },
      out: { type: 'string', short: 'o' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  })

  if (values.help) {
    console.log(`
Usage:
  npm run figma:fetch -- <fileKey> [nodeId ...]
  npm run figma:fetch -- --url "<figma design url>"
  npm run figma:fetch -- <fileKey> <nodeId> --out frame.json

Examples:
  npm run figma:fetch -- abcdefghijklmnop
  npm run figma:fetch -- abcdefghijklmnop 123:456
  npm run figma:fetch -- -u "https://www.figma.com/design/abc.../File?node-id=123-456"
`)
    process.exit(0)
  }

  const token = process.env.FIGMA_TOKEN?.trim()
  if (!token) {
    console.error('Missing FIGMA_TOKEN. Add it to .env (see .env.example).')
    process.exit(1)
  }

  let fileKey = ''
  let nodeIds = []

  if (values.url) {
    const parsed = parseFigmaUrl(values.url)
    fileKey = parsed.fileKey
    if (parsed.nodeId) nodeIds = [parsed.nodeId]
    if (!fileKey) {
      console.error('Could not parse file key from --url')
      process.exit(1)
    }
  } else {
    if (positionals.length < 1) {
      console.error('Provide <fileKey> or --url. Use --help for usage.')
      process.exit(1)
    }
    fileKey = positionals[0]
    nodeIds = positionals.slice(1).map(normalizeNodeId).filter(Boolean)
  }

  let path
  if (nodeIds.length > 0) {
    const ids = nodeIds.map((id) => encodeURIComponent(id)).join(',')
    path = `${FIGMA_API}/files/${fileKey}/nodes?ids=${ids}`
  } else {
    path = `${FIGMA_API}/files/${fileKey}`
  }

  const res = await fetch(path, { headers: buildHeaders(token) })
  const text = await res.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }

  if (!res.ok) {
    console.error(`Figma API ${res.status} ${res.statusText}`)
    console.error(typeof body === 'string' ? body : JSON.stringify(body, null, 2))
    process.exit(1)
  }

  const out = JSON.stringify(body, null, 2)
  if (values.out) {
    await writeFile(values.out, out, 'utf8')
    console.log(`Wrote ${values.out}`)
  } else {
    console.log(out)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
