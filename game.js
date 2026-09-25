(() => {
  const canvas = document.getElementById('game');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const $ = id => document.getElementById(id);
  const overlay = $('overlay'), overlayTitle = $('overlayTitle'), overlayText = $('overlayText'), startBtn = $('startBtn');
  const scoreEl = $('score'), levelEl = $('level'), bestEl = $('bestScore'), statusText = $('statusText'), statusDot = $('statusDot');
  const difficultyButtons = document.querySelectorAll('.difficulty'), rewardText = $('rewardText');
  let width = 0, height = 0, running = false, lastTime = 0, gameTime = 0, shake = 0;
  let score = 0, level = 1, elapsed = 0, meteorTimer = 0, laserTimer = 0, lavaTimer = 0;
  let difficulty = 'normal', meteors = [], lasers = [], lava = [], particles = [], warnings = [];
  let best = Number(localStorage.getItem('neonDodgeBest') || 0);
  const keys = { left: false, right: false, up: false, down: false };
  const player = { x: 0, y: 0, w: 18, h: 26, speed: 330 };

  function resize() {
    const rect = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    width = Math.max(280, rect.width); height = Math.max(260, rect.height);
    canvas.width = width * dpr; canvas.height = height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    player.x = Math.min(Math.max(player.x || width / 2, 16), width - 16);
    player.y = Math.min(Math.max(player.y || height - 42, 20), height - 20);
  }
  addEventListener('resize', resize); resize();
  const setStatus = (text, active) => { if (statusText) statusText.textContent = text; if (statusDot) statusDot.classList.toggle('active', !!active); };
  const updateHud = () => { if (scoreEl) scoreEl.textContent = score; if (levelEl) levelEl.textContent = level; if (bestEl) bestEl.textContent = best; };
  function setDifficulty(value) { difficulty = value; difficultyButtons.forEach(b => b.classList.toggle('active', b.dataset.difficulty === value)); if (rewardText) rewardText.textContent = `Récompense : +${value === 'easy' ? '0,5' : value === 'hard' ? '2' : '1'} pt / niveau`; }
  difficultyButtons.forEach(b => b.addEventListener('click', () => setDifficulty(b.dataset.difficulty)));
  function reset() { score = 0; level = 1; elapsed = 0; gameTime = 0; meteorTimer = lavaTimer = laserTimer = shake = 0; meteors = []; lasers = []; lava = []; particles = []; warnings = []; player.x = width / 2; player.y = height - 42; updateHud(); }
  function spawnMeteor() { const large = level >= 3, r = large ? 20 + Math.random() * 10 : 7 + Math.random() * 5; meteors.push({ x: r + Math.random() * (width - r * 2), y: -r, r, speed: (large ? 90 : 125) + Math.random() * (large ? 70 : 75) + level * 7, drift: (Math.random() - .5) * (large ? 35 : 20), angle: Math.random() * 6.28, spin: (Math.random() - .5) * 2 }); }
  function spawnLaser() { const side = Math.floor(Math.random() * 4), speed = 210 + level * 10, t = 3; let l; if (side === 0) l = { x: Math.random() * width, y: -10, vx: 0, vy: speed, w: t, h: 34 }; if (side === 1) l = { x: Math.random() * width, y: height + 10, vx: 0, vy: -speed, w: t, h: 34 }; if (side === 2) l = { x: -10, y: Math.random() * height, vx: speed, vy: 0, w: 34, h: t }; if (side === 3) l = { x: width + 10, y: Math.random() * height, vx: -speed, vy: 0, w: 34, h: t }; lasers.push(l); }
  function volcanoX(index) { return width * [.18, .5, .82][index]; }
  function spawnLavaSalvo() {
    const count = 3 + Math.min(3, Math.floor((level - 10) / 3));
    const center = Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const source = (center + (i % 3)) % 3, x = volcanoX(source) + (Math.random() - .5) * 34, r = 7 + Math.random() * 8;
      warnings.push({ x, life: .5 + i * .08, max: .5 + i * .08 });
      setTimeout(() => { if (!running) return; lava.push({ x, y: 4, r, speed: 150 + level * 9 + Math.random() * 70, drift: (Math.random() - .5) * (18 + level * 1.2), wobble: Math.random() * 6.28, spin: Math.random() * 6.28 }); burst(x, 12, '#ff6a24', 5); }, i * Math.max(90, 230 - level * 5));
    }
  }
  function burst(x, y, color = '#ff3d81', amount = 12) { for (let i = 0; i < amount; i++) particles.push({ x, y, vx: (Math.random() - .5) * 150, vy: (Math.random() - .5) * 150, life: .45 + Math.random() * .25, color }); }
  function hitCircle(x, y, r) { const dx = Math.max(Math.abs(x - player.x) - player.w / 2, 0), dy = Math.max(Math.abs(y - player.y) - player.h / 2, 0); return dx * dx + dy * dy < r * r; }
  function hitBox(o) { return player.x + player.w / 2 > o.x - (o.w || o.r) / 2 && player.x - player.w / 2 < o.x + (o.w || o.r) / 2 && player.y + player.h / 2 > o.y - (o.h || o.r) / 2 && player.y - player.h / 2 < o.y + (o.h || o.r) / 2; }
  function showOverlay(title, text, button = 'LANCER LA PARTIE <span>→</span>') { if (overlay) { overlay.hidden = false; overlay.style.display = 'flex'; overlay.style.pointerEvents = 'auto'; } if (overlayTitle) overlayTitle.textContent = title; if (overlayText) overlayText.innerHTML = text; if (startBtn) { startBtn.disabled = false; startBtn.style.pointerEvents = 'auto'; startBtn.style.opacity = '1'; startBtn.innerHTML = button; } }
  function hideOverlay() { if (overlay) { overlay.hidden = true; overlay.style.display = 'none'; overlay.style.pointerEvents = 'none'; } if (startBtn) { startBtn.disabled = true; startBtn.style.pointerEvents = 'none'; startBtn.style.opacity = '0'; } }
  function gameOver() { running = false; setStatus('GAME OVER', false); if (score > best) { best = score; localStorage.setItem('neonDodgeBest', best); } updateHud(); showOverlay('PARTIE TERMINÉE', `Score : <b>${score}</b><br>Atteins le niveau ${level + 1} pour aller plus loin.`, 'REJOUER <span>→</span>'); burst(player.x, player.y); }
  function start() { reset(); running = true; setStatus('EN JEU', true); hideOverlay(); lastTime = performance.now(); requestAnimationFrame(loop); }
  startBtn?.addEventListener('click', start);
  function movePlayer(dt) { const dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0), dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0); player.x = Math.max(13, Math.min(width - 13, player.x + dx * player.speed * dt)); player.y = Math.max(18, Math.min(height - 18, player.y + dy * player.speed * dt)); }
  addEventListener('keydown', e => { if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','a','d','w','s'].includes(e.key)) e.preventDefault(); if (e.key === 'ArrowLeft' || e.key === 'a') keys.left = true; if (e.key === 'ArrowRight' || e.key === 'd') keys.right = true; if (e.key === 'ArrowUp' || e.key === 'w') keys.up = true; if (e.key === 'ArrowDown' || e.key === 's') keys.down = true; if ((e.key === ' ' || e.key === 'Enter') && !running) start(); });
  addEventListener('keyup', e => { if (e.key === 'ArrowLeft' || e.key === 'a') keys.left = false; if (e.key === 'ArrowRight' || e.key === 'd') keys.right = false; if (e.key === 'ArrowUp' || e.key === 'w') keys.up = false; if (e.key === 'ArrowDown' || e.key === 's') keys.down = false; });
  let touching = false;
  canvas.addEventListener('pointerdown', e => { if (!running) { start(); return; } touching = true; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => { if (!touching) return; const r = canvas.getBoundingClientRect(); player.x = Math.max(13, Math.min(width - 13, e.clientX - r.left)); player.y = Math.max(18, Math.min(height - 18, e.clientY - r.top)); });
  canvas.addEventListener('pointerup', () => touching = false);

  function update(dt) {
    gameTime += dt; elapsed += dt;
    const nextLevel = Math.min(20, Math.floor(elapsed / 10) + 1);
    if (nextLevel !== level) { level = nextLevel; updateHud(); burst(player.x, player.y, level >= 10 ? '#ff762e' : '#52f7ff', level >= 10 ? 24 : 12); shake = level >= 10 ? .25 : .1; }
    score = Math.floor(elapsed * (difficulty === 'easy' ? .7 : difficulty === 'hard' ? 1.8 : 1));
    meteorTimer -= dt; const meteorInterval = Math.max(.26, (level < 3 ? .72 : .92 - level * .045) - (level >= 16 ? .1 : 0)); if (meteorTimer <= 0) { spawnMeteor(); if (level >= 4 && Math.random() < .28) spawnMeteor(); meteorTimer = meteorInterval; }
    if (level >= 5) { laserTimer -= dt; if (laserTimer <= 0) { spawnLaser(); laserTimer = Math.max(.32, 1.15 - level * .035); } }
    if (level >= 10) { lavaTimer -= dt; if (lavaTimer <= 0) { spawnLavaSalvo(); lavaTimer = Math.max(.9, 3.2 - (level - 10) * .16); } }
    movePlayer(dt); meteors.forEach(m => { m.y += m.speed * dt; m.x += m.drift * dt; m.angle += m.spin * dt; }); lasers.forEach(l => { l.x += l.vx * dt; l.y += l.vy * dt; }); lava.forEach(l => { l.y += l.speed * dt; l.x += Math.sin(l.y / 35 + l.wobble) * l.drift * dt; l.spin += dt * 4; });
    meteors = meteors.filter(m => m.y < height + m.r + 10); lasers = lasers.filter(l => l.x > -60 && l.x < width + 60 && l.y > -60 && l.y < height + 60); lava = lava.filter(l => l.y < height + l.r + 10);
    warnings.forEach(w => w.life -= dt); warnings = warnings.filter(w => w.life > 0); particles.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }); particles = particles.filter(p => p.life > 0); shake = Math.max(0, shake - dt);
    if (meteors.some(m => hitCircle(m.x, m.y, m.r * .78)) || lasers.some(hitBox) || lava.some(l => hitCircle(l.x, l.y, l.r))) return gameOver(); updateHud();
  }
  function drawVolcanoes() {
    for (let i = 0; i < 3; i++) { const x = volcanoX(i), base = height + 18, top = height - (70 + i % 2 * 25), pulse = Math.sin(gameTime * 3 + i) * 3; ctx.fillStyle = i === 1 ? '#35131a' : '#241018'; ctx.beginPath(); ctx.moveTo(x - 92, base); ctx.lineTo(x - 24, top); ctx.quadraticCurveTo(x, top - 15 + pulse, x + 24, top); ctx.lineTo(x + 92, base); ctx.fill(); ctx.fillStyle = '#ff4b22'; ctx.shadowBlur = 18; ctx.shadowColor = '#ff4b22'; ctx.beginPath(); ctx.ellipse(x, top + 2, 22 + pulse, 7, 0, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,125,52,.18)'; ctx.beginPath(); ctx.arc(x - 18, top - 25 - Math.sin(gameTime * 2 + i) * 7, 5, 0, Math.PI * 2); ctx.arc(x + 17, top - 38 - Math.cos(gameTime * 2 + i) * 8, 4, 0, Math.PI * 2); ctx.fill(); }
  }
  function draw() {
    const volcanic = level >= 10; ctx.clearRect(0, 0, width, height); ctx.fillStyle = volcanic ? '#180b13' : '#090d1f'; ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = volcanic ? 'rgba(255,96,35,.09)' : 'rgba(82,247,255,.055)'; ctx.lineWidth = 1; for (let x = 0; x < width; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); } for (let y = 0; y < height; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
    if (volcanic) { drawVolcanoes(); ctx.fillStyle = '#ff542e'; ctx.globalAlpha = .28; ctx.fillRect(0, height - 5, width, 5); ctx.globalAlpha = 1; warnings.forEach(w => { const alpha = Math.max(0, w.life / w.max); ctx.strokeStyle = `rgba(255,185,55,${alpha})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(w.x, height - 18, 13 + (1 - alpha) * 22, 0, Math.PI * 2); ctx.stroke(); }); }
    lasers.forEach(l => { ctx.shadowBlur = 16; ctx.shadowColor = '#ff3d81'; ctx.fillStyle = '#ff3d81'; ctx.fillRect(l.x - l.w / 2, l.y - l.h / 2, l.w, l.h); ctx.shadowBlur = 0; });
    meteors.forEach(m => { ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(m.angle); ctx.shadowBlur = 12; ctx.shadowColor = '#ff3d81'; ctx.fillStyle = m.r > 15 ? '#bd245e' : '#ff3d81'; ctx.beginPath(); ctx.moveTo(0, -m.r); ctx.lineTo(m.r * .8, 0); ctx.lineTo(0, m.r); ctx.lineTo(-m.r * .8, 0); ctx.closePath(); ctx.fill(); ctx.restore(); });
    lava.forEach(l => { ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(l.spin); ctx.shadowBlur = 20; ctx.shadowColor = '#ff4d20'; ctx.fillStyle = '#ff4d20'; ctx.beginPath(); ctx.arc(0, 0, l.r + 4, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#ffd04a'; ctx.beginPath(); ctx.arc(-2, -2, l.r * .58, 0, Math.PI * 2); ctx.fill(); ctx.restore(); });
    ctx.save(); ctx.translate(player.x + (shake ? (Math.random() - .5) * 5 : 0), player.y); ctx.shadowBlur = volcanic ? 22 : 18; ctx.shadowColor = volcanic ? '#ffb52e' : '#52f7ff'; ctx.fillStyle = volcanic ? '#ffb52e' : '#52f7ff'; ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(12, 13); ctx.lineTo(0, 7); ctx.lineTo(-12, 13); ctx.closePath(); ctx.fill(); ctx.restore(); particles.forEach(p => { ctx.globalAlpha = Math.max(0, p.life * 2); ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, 3, 3); }); ctx.globalAlpha = 1;
  }
  function loop(now) { if (!running) { draw(); return; } const dt = Math.min((now - lastTime) / 1000, .05); lastTime = now; update(dt); draw(); if (running) requestAnimationFrame(loop); }
  showOverlay('PRÊT À JOUER ?', 'Évite les météores rouges.<br>Chaque niveau rapporte des points.', 'LANCER LA PARTIE <span>→</span>'); setDifficulty('normal'); updateHud(); draw();
})();
