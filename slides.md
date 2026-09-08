# How does a coding agent harness actually work?

## What is a coding agent/harness?

Environment for an AI model to operate in:

- Chat / interaction with user
- System prompt
- Tools

(And more: skills, MCP, (sub)agents etc.)


## Chat

Conversation as a list of messages:

1. Prompt the user for input
   - Add the new message to the conversation
2. Submit the whole conversation to the model to complete
   - Append model response to the conversation
3. Repeat


```javascript
const messages = []

// Endless loop
while (true) {

  // Read user input
  console.log('You: ')
  const userInput = readInput()

  // Append user message to the conversation
  messages.push({ role: 'user', content: userInput })

  // Let LLM generate a completion
  const modelOutput = completionAPI(messages)

  console.log(`AI: ${modelOutput}`)

  // Append response to the conversation
  messages.push({ role: 'assistant', content: modelOutput })
}
```

## System prompt

(Special) message at the beginning of the conversation


```javascript
const messages = []

// Add system prompt as first message to the conversation
const systemPrompt = 'You are a coding assistant. Any question that is not related to coding should be politely rejected.'
messages.push({ role: 'system', content: systemPrompt })

// Endless loop
while (true) {
  // ...
}
```

## Tools

“Contract” between harness and model that describes requests from the model to execute a tool and responses from the user/harness to these tool executions:

1. Check if the last message from the model is a tool call
2. If yes:
   - Execute the tool locally
   - Respond with a message containing the tool call result


```javascript
// Description of tool contract and "bash" tool
const systemPrompt = `
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
```

```javascript
while (true) {
  // ...

  const modelOutput = completionAPI(messages)

  // Check if model requests a tool call
  const toolCall = extractToolCall(modelOutput)

  if (toolCall) {
    // Execute the tool (i.e. run the bash command locally)
    const { toolSuccess, toolOutput } = executeToolCall(toolCall)

    // Append the tool call request...
    messages.push({ role: 'assistant', content: text })

    // ...and the tool call response to the conversation
    messages.push({
      role: 'user',
      content: JSON.stringify({ tool_success: toolSuccess, tool_output: toolOutput }),
    })

  } else {
    // ...
  }
}
```
