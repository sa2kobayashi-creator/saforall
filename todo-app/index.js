const express = require('express')
const path = require('path')

const app = express()
const PORT = 3000

/** @type {{ id: number, title: string, completed: boolean }[]} */
let todos = [
  { id: 1, title: '買い物に行く', completed: false },
  { id: 2, title: 'レポートを書く', completed: true }
]
let nextId = 3

app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'views'))
app.use(express.urlencoded({ extended: true }))
app.use(express.json())

app.get('/', (_req, res) => {
  res.redirect('/todos')
})

app.get('/todos', (_req, res) => {
  res.render('todos', { todos })
})

app.post('/todos', (req, res) => {
  const title = String(req.body.title || '').trim()
  if (title) {
    todos.push({ id: nextId++, title, completed: false })
  }
  res.redirect('/todos')
})

app.post('/todos/:id/toggle', (req, res) => {
  const id = Number(req.params.id)
  const todo = todos.find((item) => item.id === id)
  if (todo) todo.completed = !todo.completed
  res.redirect('/todos')
})

app.post('/todos/:id/delete', (req, res) => {
  const id = Number(req.params.id)
  todos = todos.filter((item) => item.id !== id)
  res.redirect('/todos')
})

app.listen(PORT, () => {
  console.log(`ToDo app: http://localhost:${PORT}`)
})
