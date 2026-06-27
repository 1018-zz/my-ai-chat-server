require('dotenv').config()
const express = require('express')
const cors = require('cors')
const OpenAI = require('openai')

const app = express()
app.use(cors())
app.use(express.json())

const openai = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY,
})

app.post('/api/chat', async (req, res) => {
  const { messages, model = 'deepseek-chat' } = req.body

  try {
    const completion = await openai.chat.completions.create({
      messages,
      model,
      temperature: 0.7,
    })

    res.json({
      content: completion.choices[0].message.content,
      usage: completion.usage,
    })
  } catch (error) {
    console.error('API Error:', error.message)
    res.status(500).json({ error: error.message })
  }
})

const PORT = process.env.PORT || 10000
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})