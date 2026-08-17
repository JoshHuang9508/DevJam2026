const id = (await (await fetch("http://localhost:5173/backend/sessions", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}",
})).json()).id;
console.log("session", id);
const res = await fetch(`http://localhost:5173/backend/sessions/${id}/messages`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "text/event-stream" },
  body: JSON.stringify({ message: "我想在台北租屋，預算兩萬，要近捷運" }),
});
const text = await res.text();
const types = [...text.matchAll(/^event: (.+)$/gm)].map((m) => m[1]);
console.log("events", types.join(" -> "));
for (const block of text.split("\n\n")) {
  if (!block.includes("tool.completed")) continue;
  const line = block.split("\n").find((item) => item.startsWith("data:"));
  if (!line) continue;
  const payload = JSON.parse(line.slice(5).trim());
  console.log("tool.completed keys", Object.keys(payload), "name", payload.toolName, "resultType", payload.result === undefined ? "missing" : typeof payload.result);
}
const session = await (await fetch(`http://localhost:5173/backend/sessions/${id}`)).json();
console.log("db conversation", session.conversation.length, "candidates", session.candidates.length, "pref v", session.preferences.version);
