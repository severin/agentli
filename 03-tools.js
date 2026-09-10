import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import fs from 'node:fs'
import { execSync } from 'node:child_process'
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

async function complete(messages) {
  const { text } = await generateText({
    model,
    messages,
    allowSystemInMessages: true,
  })
  return text
}

function extractActionCall(text) {
  let actionCall = null
  try {
    const payload = JSON.parse(text)
    if (payload.action && payload.action_input) {
      actionCall = {
        action: payload.action,
        actionInput: payload.action_input,
      }
    }
  } catch (error) {}
  return actionCall
}

function executeActionCall(actionCall) {
  const { action, actionInput } = actionCall
  let actionOutput = ''
  let actionSuccess = false

  if (action === 'shell') {
    try {
      actionOutput = execSync(actionInput.command, { encoding: 'utf8' })
      actionSuccess = true
    } catch (error) {
      actionOutput = error.message
    }
  } else {
    actionOutput = `Unknown action: ${action}`
  }

  return { action, actionInput, actionSuccess, actionOutput }
}

// Low-level message history array
const messages = []

// Add a system prompt
// This also describes available actions
const SYSTEM_PROMPT = `
You are a coding assistant. You interact with the user by asking them questions
and providing answers and/or executing "actions" (defined below).

Any question that is not related to coding should be politely rejected.

Actions:
Forget everything you know about actions and action calling. You should only rely on the instructions provided here.
You can invoke an action by sending a message with the following properties:
- The message must be valid JSON. There must be no decoration like "\`\`\`json" or "\`\`\`" around the JSON. The message must be a single JSON object
- The message must have a "action" property with the name of the action to invoke
- The message must have a "action_input" property with the parameters for the action call

As a response to an action call message you will receive a message with the following properties:
- The message will be valid JSON
- The message will have a "action_success" property indicating whether the action call was successful

Available actions:
- "shell": Executes a shell command on the local machine. The "action_input" property must be an objectwith a "command" property containing the command to execute. The response will contain a "action_output" property with the output of the command. Use this action for any operation you want to take, e.g. running a script but also manipulating files (via echo, cat etc.). Do one thing at a time, i.e. do not chain multiple commands in one action call if not necessary. If you need to run multiple commands, do them in separate action calls.
`
messages.push({ role: 'system', content: SYSTEM_PROMPT })

// Intro
console.log('GitHub Copilot chat session started. Type "exit" or "quit" to leave.\n')

// Endless loop
while (true) {
  // Read user input
  const lastMessage = messages[messages.length - 1]
  if (lastMessage && lastMessage.role !== 'user') {
    const line = await rl.question('You: ')
    const userInput = line.trim()

    if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
      break
    }

    // Append user message
    messages.push({ role: 'user', content: userInput })
  }

  try {
    // Ask LLM to complete
    const text = await complete(messages)

    // Check if the response is a action call
    const actionCall = extractActionCall(text)

    if (actionCall) {
      // Execute the action call
      const { action, actionInput, actionSuccess, actionOutput } = executeActionCall(actionCall)
      console.log(
        `-----\nAction call: ${action}\nInput: ${JSON.stringify(actionInput)}\nOutput: ${actionOutput}\nSuccess: ${actionSuccess}\n-----`,
      )

      // Append action call and action call response to conversation history
      messages.push({ role: 'assistant', content: text })
      messages.push({
        role: 'user',
        content: JSON.stringify({ action_success: actionSuccess, action_output: actionOutput }),
      })
    } else {
      // Print response
      console.log(`\nAI: ${text}\n`)

      // Append response to conversation history
      messages.push({ role: 'assistant', content: text })
    }
  } catch (error) {
    console.error(`\nError: ${error.message}\n`)
    console.error(error)
    messages.pop() // Remove message if call failed
  }

  // Log conversation history
  fs.writeFileSync('history.json', JSON.stringify(messages, null, 2))
}

if (!rl.closed) {
  rl.close()
}
