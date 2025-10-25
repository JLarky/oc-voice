// ask.ts
// Removed valibot validation; using direct response parsing.

const PORT = 2323;
const HOST = `http://192.168.215.4:${PORT}`;
const question = Bun.argv.slice(2).join(" ");

if (!question) {
  console.error("❌ Please provide a question as an argument.");
  process.exit(1);
}

// Direct response parsing (no valibot schemas)

// Create a new session
const sessionRes = await fetch(`${HOST}/session`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ title: "ask-script-session" }),
});

if (!sessionRes.ok) {
  console.error("❌ Failed to create session");
  process.exit(1);
}

const { id: sessionId } = await sessionRes.json();

const messageRes = await fetch(`${HOST}/session/${sessionId}/message`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    parts: [{ type: "text", text: question }],
  }),
});

const data = await messageRes.json();

const parts = Array.isArray(data.parts)
  ? data.parts.filter((p) => p.type === "text" && typeof p.text === "string")
  : [];
const answer = parts.map((p) => p.text).join("\n");
console.log("✅ Answer:", answer || "No answer text parts found.");
