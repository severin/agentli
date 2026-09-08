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

function extractToolCall(text) {
  let toolCall = null
  try {
    const payload = JSON.parse(text)
    if (payload.tool && payload.tool_input) {
      toolCall = {
        tool: payload.tool,
        toolInput: payload.tool_input,
      }
    }
  } catch (error) {}
  return toolCall
}

function executeToolCall(toolCall) {
  const { tool, toolInput } = toolCall
  let toolOutput = ''
  let toolSuccess = false

  if (tool === 'bash') {
    try {
      toolOutput = execSync(toolInput.command, { encoding: 'utf8' })
      toolSuccess = true
    } catch (error) {
      toolOutput = error.message
    }
  } else {
    toolOutput = `Unknown tool: ${tool}`
  }

  return { tool, toolInput, toolSuccess, toolOutput }
}

// Low-level message history array
const messages = []

// Add a system prompt
// This also describes available tools
const SYSTEM_PROMPT = `
You are a coding assistant. You interact with the user by asking them questions
and providing answers. You might also use tools (defined below).

Any question that is not related to coding should be politely rejected.

Tools:
You can invoke a tool by sending a message with the following properties:
- The message must be valid JSON. There must be no decoration like "\`\`\`json" or "\`\`\`" around the JSON. The message must be a single JSON object
- The message must have a "tool" property with the name of the tool to invoke
- The message must have a "tool_input" property with the parameters for the tool call

As a response to a tool call message you will receive a message with the following properties:
- The message will be valid JSON
- The message will have a "tool_success" property indicating whether the tool call was successful

Available tools:
- "bash": Executes a bash command on the local machine. The "tool_input" property must be an objectwith a "command" property containing the command to execute. The response will contain a "tool_output" property with the output of the command. Use this tool for any action you want to take, e.g. running a script but also manipulating files (via echo, cat etc.). Do one thing at a time, i.e. do not chain multiple commands in one tool call if not necessary. If you need to run multiple commands, do them in separate tool calls.
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

    // Check if the response is a tool call
    const toolCall = extractToolCall(text)

    if (toolCall) {
      // Execute the tool call
      const { tool, toolInput, toolSuccess, toolOutput } = executeToolCall(toolCall)
      console.log(
        `-----\nTool call: ${tool}\nInput: ${JSON.stringify(toolInput)}\nOutput: ${toolOutput}\nSuccess: ${toolSuccess}\n-----`,
      )

      // Append tool call and tool call response to conversation history
      messages.push({ role: 'assistant', content: text })
      messages.push({
        role: 'user',
        content: JSON.stringify({ tool_success: toolSuccess, tool_output: toolOutput }),
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
