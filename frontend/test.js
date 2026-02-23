const prev = [
  { speaker: 'ai', text: 'Hello', final: false },
  { speaker: 'user', text: 'Hi', final: false }
];
let lastAiIndex = -1;
for (let i = prev.length - 1; i >= 0; i--) {
  if (prev[i].speaker === 'ai') { lastAiIndex = i; break; }
}
console.log(lastAiIndex);
