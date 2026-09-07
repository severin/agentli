import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import fs from 'node:fs'
import { generateText } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

try {
  process.loadEnvFile()
} catch {}

function getCopilotToken() {
  if (process.env.COPILOT_TOKEN) return process.env.COPILOT_TOKEN
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN

  // Fallback to local OpenCode / Copilot credentials
  try {
    const authPath = `${process.env.HOME}/.local/share/opencode/auth.json`
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'))
    if (auth['github-copilot']?.access) {
      return auth['github-copilot'].access
    }
  } catch {}

  throw new Error(
    'No GitHub Copilot token found. Set COPILOT_TOKEN or GITHUB_TOKEN in your environment.',
  )
}

const token = getCopilotToken()

const copilot = createOpenAICompatible({
  name: 'github-copilot',
  baseURL: 'https://api.githubcopilot.com',
  headers: {
    Authorization: `Bearer ${token}`,
    'Editor-Version': 'vscode/1.95.0',
    'User-Agent': 'GitHubCopilotChat/0.22.0',
    'Copilot-Integration-Id': 'vscode-chat',
  },
})

const model = copilot(process.env.COPILOT_MODEL || 'gemini-3.8-flash')

const rl = readline.createInterface({ input, output })

// Low-level message history array
const messages = []

messages.push({
  role: 'system',
  content:
    'You are a coding assistant. Any question that is not related to coding should be politely rejected.',
})

// Intro
console.log('GitHub Copilot chat session started. Type "exit" or "quit" to leave.\n')
rl.setPrompt('You: ')
rl.prompt()

// Endless loop
for await (const line of rl) {
  // Read user input
  const userInput = line.trim()

  if (!userInput) {
    if (!rl.closed) rl.prompt()
    continue
  }

  if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
    break
  }

  // Append user message
  messages.push({ role: 'user', content: userInput })

  try {
    // Ask LLM to complete
    const { text } = await generateText({
      model,
      messages,
    })

    console.log(`\nAI: ${text}\n`)

    // Append  response to conversation history
    messages.push({ role: 'assistant', content: text })
  } catch (error) {
    console.error(`\nError: ${error.message}\n`)
    console.error(error)
    messages.pop() // Remove message if call failed
  }

  // Log conversation history
  fs.writeFileSync('history.json', JSON.stringify(messages, null, 2))

  if (!rl.closed) {
    rl.prompt()
  }
}

if (!rl.closed) {
  rl.close()
}
