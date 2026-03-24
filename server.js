const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "VI.TOR72";
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const db = new Database(path.join(__dirname, "anatomia.db"));
db.exec(`
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  matricula TEXT NOT NULL,
  instituicao TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  senha TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS approved_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  matricula TEXT NOT NULL,
  instituicao TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  senha TEXT NOT NULL,
  approved_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rejected_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  matricula TEXT NOT NULL,
  instituicao TEXT NOT NULL,
  email TEXT NOT NULL,
  senha TEXT NOT NULL,
  rejected_at TEXT NOT NULL
);
`);

function nowBr(){ return new Date().toLocaleString("pt-BR"); }
function validarMatricula(m){ return typeof m === "string" && m.trim().length === 7; }
function validarEmail(email, instituicao, matricula){
  email = String(email || "").trim().toLowerCase();
  matricula = String(matricula || "").trim();
  const pessoais = ["gmail.","hotmail.","yahoo.","outlook.","icloud."];
  const dominio = email.split("@")[1] || "";
  if (pessoais.some(x => dominio.includes(x))) return false;
  if (instituicao === "cecape") return email === `${matricula}@faculdadececape.edu.br`;
  return /^[a-z][a-z0-9._-]*@[^@]+\.(edu|edu\.br|org|br|com\.br)$/i.test(email);
}

app.post("/api/register", (req, res) => {
  try {
    const { matricula, instituicao, email, senha } = req.body;
    if (!validarMatricula(matricula)) return res.status(400).json({ ok:false, message:"A matrícula deve ter exatamente 7 caracteres." });
    if (!instituicao) return res.status(400).json({ ok:false, message:"Selecione a instituição." });
    if (!validarEmail(email, instituicao, matricula)) return res.status(400).json({ ok:false, message: instituicao === "cecape" ? "Para Cecape, use matrícula@faculdadececape.edu.br." : "Use apenas e-mail institucional válido." });
    if (!senha || String(senha).trim().length < 4) return res.status(400).json({ ok:false, message:"Informe uma senha válida." });
    const emailLower = email.trim().toLowerCase();
    if (db.prepare("SELECT id FROM approved_users WHERE email = ?").get(emailLower) || db.prepare("SELECT id FROM requests WHERE email = ?").get(emailLower)) {
      return res.status(400).json({ ok:false, message:"Esse e-mail já possui cadastro ou pedido em análise." });
    }
    db.prepare("INSERT INTO requests (matricula, instituicao, email, senha, created_at) VALUES (?, ?, ?, ?, ?)").run(matricula.trim(), instituicao, emailLower, String(senha), nowBr());
    res.json({ ok:true, message:"Pedido enviado com sucesso." });
  } catch {
    res.status(500).json({ ok:false, message:"Erro ao enviar pedido." });
  }
});

app.post("/api/login", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const senha = String(req.body.senha || "").trim();
  const user = db.prepare("SELECT * FROM approved_users WHERE email = ? AND senha = ?").get(email, senha);
  if (!user) return res.status(401).json({ ok:false, message:"Usuário não aprovado ou dados incorretos." });
  res.json({ ok:true, user:{ email:user.email, matricula:user.matricula, instituicao:user.instituicao } });
});

app.post("/api/admin/login", (req, res) => {
  if (String(req.body.senha || "") !== ADMIN_PASSWORD) return res.status(401).json({ ok:false, message:"Senha incorreta." });
  res.json({ ok:true });
});
app.get("/api/admin/pending", (_req, res) => res.json(db.prepare("SELECT * FROM requests ORDER BY id DESC").all()));
app.get("/api/admin/approved", (_req, res) => res.json(db.prepare("SELECT * FROM approved_users ORDER BY id DESC").all()));
app.get("/api/admin/rejected", (_req, res) => res.json(db.prepare("SELECT * FROM rejected_users ORDER BY id DESC").all()));

app.post("/api/admin/approve/:id", (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM requests WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ ok:false, message:"Pedido não encontrado." });
  if (!db.prepare("SELECT id FROM approved_users WHERE email = ?").get(row.email)) {
    db.prepare("INSERT INTO approved_users (matricula, instituicao, email, senha, approved_at) VALUES (?, ?, ?, ?, ?)").run(row.matricula, row.instituicao, row.email, row.senha, nowBr());
  }
  db.prepare("DELETE FROM rejected_users WHERE email = ?").run(row.email);
  db.prepare("DELETE FROM requests WHERE id = ?").run(id);
  res.json({ ok:true, message:"Usuário aprovado com sucesso." });
});

app.post("/api/admin/reject/:id", (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM requests WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ ok:false, message:"Pedido não encontrado." });
  if (!db.prepare("SELECT id FROM rejected_users WHERE email = ?").get(row.email)) {
    db.prepare("INSERT INTO rejected_users (matricula, instituicao, email, senha, rejected_at) VALUES (?, ?, ?, ?, ?)").run(row.matricula, row.instituicao, row.email, row.senha, nowBr());
  }
  db.prepare("DELETE FROM approved_users WHERE email = ?").run(row.email);
  db.prepare("DELETE FROM requests WHERE id = ?").run(id);
  res.json({ ok:true, message:"Usuário rejeitado." });
});

app.post("/api/forgot/start", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const user = db.prepare("SELECT id FROM approved_users WHERE email = ?").get(email);
  if (!user) return res.status(404).json({ ok:false, message:"Nenhum usuário aprovado encontrado com esse e-mail." });
  res.json({ ok:true });
});

app.post("/api/forgot/reset", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const senha = String(req.body.senha || "").trim();
  if (!senha || senha.length < 4) return res.status(400).json({ ok:false, message:"Informe uma nova senha válida." });
  const result = db.prepare("UPDATE approved_users SET senha = ? WHERE email = ?").run(senha, email);
  if (!result.changes) return res.status(404).json({ ok:false, message:"Usuário não encontrado." });
  res.json({ ok:true, message:"Senha redefinida com sucesso." });
});

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
