require('dotenv').config()
const express = require('express')
const cors = require('cors')
const OpenAI = require('openai')
const { createClient } = require('@supabase/supabase-js')

const app = express()
app.use(cors())
app.use(express.json())

// 初始化 Supabase 客户端
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
)

// 初始化 DeepSeek 客户端
const openai = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY,
})

// ==================== API 路由 ====================

// 聊天接口
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

// ==================== 启动 ====================
const PORT = process.env.PORT || 10000
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})