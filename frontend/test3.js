const transcript = [
  { speaker: 'ai', text: 'Hello', final: false },
  { speaker: 'ai', text: 'Hello how are you doing', final: false }
];

const getFixed = () => {
    const prev = [...transcript];
    let lastIndex = -1;
    for (let i = prev.length - 1; i >= 0; i--) {
    if (prev[i].speaker === 'ai') { lastIndex = i; break; }
    }

    const delta = ' today';
    if (lastIndex !== -1 && !prev[lastIndex].final) {
    prev[lastIndex] = { ...prev[lastIndex], text: prev[lastIndex].text + delta };
    return prev;
    }
    return [...prev, { speaker: 'ai', text: delta, final: false }];
}
console.log(getFixed());
