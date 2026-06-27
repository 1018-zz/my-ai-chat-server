require('dotenv').config()
const express = require('express')
const cors = require('cors')
const OpenAI = require('openai')
const { createClient } = require('@supabase/supabase-js')

const app = express()
app.use(cors())
app.use(express.json())

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
)

const openai = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY,
})

// ==================== 聊天接口（含存储） ====================
app.post('/api/chat', async (req, res) => {
  const { messages, model = 'deepseek-chat', conversationId } = req.body

  try {
    // 如果没有会话 ID，自动创建一个新会话
    let convId = conversationId
    if (!convId) {
      const { data: newConv } = await supabase
        .from('conversations')
        .insert({ title: messages[messages.length - 1]?.content?.slice(0, 30) || '新对话' })
        .select('id')
        .single()
      convId = newConv.id
    }

    // 调用 DeepSeek
    const completion = await openai.chat.completions.create({
      messages,
      model,
      temperature: 0.7,
    })

    const aiContent = completion.choices[0].message.content
    const userMessage = messages[messages.length - 1]

    // 存储用户消息
    await supabase.from('messages').insert({
      conversation_id: convId,
      role: 'user',
      content: userMessage.content,
      token_count: completion.usage?.prompt_tokens || 0,
    })

    // 存储 AI 回复
    await supabase.from('messages').insert({
      conversation_id: convId,
      role: 'assistant',
      content: aiContent,
      token_count: completion.usage?.completion_tokens || 0,
    })

    // 更新会话时间
    await supabase
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', convId)

    res.json({
      content: aiContent,
      usage: completion.usage,
      conversationId: convId,
    })
  } catch (error) {
    console.error('API Error:', error.message)
    res.status(500).json({ error: error.message })
  }
})

// ==================== 历史消息接口 ====================
app.get('/api/messages', async (req, res) => {
  const { conversationId } = req.query

  if (!conversationId) {
    return res.status(400).json({ error: 'conversationId is required' })
  }

  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  if (error) {
    return res.status(500).json({ error: error.message })
  }

  res.json({ messages: data })
})

// ==================== 会话列表接口 ====================
app.get('/api/conversations', async (req, res) => {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .order('updated_at', { ascending: false })

  if (error) {
    return res.status(500).json({ error: error.message })
  }

  res.json({ conversations: data })
})

// ==================== 启动 ====================
const PORT = process.env.PORT || 10000
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})