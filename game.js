(() => {
  const canvas = document.getElementById('game');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const levelEl = document.getElementById('level');
  const bestEl = document.getElementById('bestScore');
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlayTitle');
  const overlayText = document.getElementById('overlayText');
  const startBtn = document.getElementById('startBtn');
  const statusText = document.getElementById('statusText');
  const statusDot = document.getElementById('statusDot');
  const difficultyButtons = document.querySelectorAll('.difficulty');
  const rewardText = document.getElementById('rewardText');

  let width = 0, height = 0, running = false, lastTime = 0;
  let score = 0, level = 1, elapsed = 0, meteorTimer = 0, laserTimer = 0;
  let difficulty = 'normal';
  let meteors = [], lasers = [], particles = [];
  let best = Number(localStorage.getItem('neonDodgeBest') || 0);
  const keys = { left: false, right: false, up: false, down: false };
  const player = { x: 0, y: 0, w: 18, h: 26, speed: 330 };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(280, rect.width);
    height = Math.max(260, rect.height);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    player.x = Math.min(Math.max(player.x || width / 2, 16), width - 16);
    player.y = Math.min(Math.max(player.y || height - 42, 20), height - 20);
  }
  window.addEventListener('resize', resize);
  resize();

  function setStatus(text, active) {
    if (statusText) statusText.textContent = text;
    if (statusDot) statusDot.classList.toggle('active', !!active);
  }
  function updateHud() {
    if (scoreEl) scoreEl.textContent = String(score);
    if (levelEl) levelEl.textContent = String(level);
    if (bestEl) bestEl.textContent = String(best);
  }
  function setDifficulty(value) {
    difficulty = value;
    difficultyButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.difficulty === value));
    if (rewardText) rewardText.textContent = `Récompense : +${value === 'easy' ? '0,5' : value === 'hard' ? '2' : '1'} pt / niveau`;
  }
  difficultyButtons.forEach(btn => btn.addEventListener('click', () => setDifficulty(btn.dataset.difficulty)));

  function reset() {
    score = 0; level = 1; elapsed = 0; meteorTimer = 0; laserTimer = 0;
    meteors = []; lasers = []; particles = [];
    player.x = width / 2; player.y = height - 42;
    updateHud();
  }
  function spawnMeteor() {
    const large = level >= 3;
    const radius = large ? 20 + Math.random() * 10 : 7 + Math.random() * 5;
    meteors.push({
      x: radius + Math.random() * (width - radius * 2), y: -radius,
      r: radius, speed: (large ? 90 : 125) + Math.random() * (large ? 70 : 75) + level * 7,
      drift: (Math.random() - .5) * (large ? 35 : 20), angle: Math.random() * 6.28,
      spin: (Math.random() - .5) * 2
    });
  }
  function spawnLaser() {
    if (level < 5) return;
    const side = Math.floor(Math.random() * 4);
    const thickness = 3;
    const speed = 210 + level * 10;
    let laser;
    if (side === 0) laser = { x: Math.random() * width, y: -10, vx: 0, vy: speed, w: thickness, h: 34 };
    if (side === 1) laser = { x: Math.random() * width, y: height + 10, vx: 0, vy: -speed, w: thickness, h: 34 };
    if (side === 2) laser = { x: -10, y: Math.random() * height, vx: speed, vy: 0, w: 34, h: thickness };
    if (side === 3) laser = { x: width + 10, y: Math.random() * height, vx: -speed, vy: 0, w: 34, h: thickness };
    lasers.push(laser);
  }
  function burst(x, y, color = '#ff3d81') {
    for (let i = 0; i < 12; i++) particles.push({ x, y, vx: (Math.random() - .5) * 150, vy: (Math.random() - .5) * 150, life: .45, color });
  }
  function hitCircle(x, y, r) {
    const dx = Math.max(Math.abs(x - player.x) - player.w / 2, 0);
    const dy = Math.max(Math.abs(y - player.y) - player.h / 2, 0);
    return dx * dx + dy * dy < r * r;
  }
  function hitLaser(l) {
    return player.x + player.w / 2 > l.x - l.w / 2 && player.x - player.w / 2 < l.x + l.w / 2 && player.y + player.h / 2 > l.y - l.h / 2 && player.y - player.h / 2 < l.y + l.h / 2;
  }

  function showOverlay(title, text, buttonText = 'LANCER LA PARTIE <span>→</span>') {
    if (overlay) {
      overlay.hidden = false;
      overlay.style.display = 'flex';
      overlay.style.pointerEvents = 'auto';
    }
    if (overlayTitle) overlayTitle.textContent = title;
    if (overlayText) overlayText.innerHTML = text;
    if (startBtn) {
      startBtn.disabled = false;
      startBtn.style.pointerEvents = 'auto';
      startBtn.style.opacity = '1';
      startBtn.innerHTML = buttonText;
    }
  }

  function hideOverlay() {
    if (overlay) {
      overlay.hidden = true;
      overlay.style.display = 'none';
      overlay.style.pointerEvents = 'none';
    }
    if (startBtn) {
      startBtn.disabled = true;
      startBtn.style.pointerEvents = 'none';
      startBtn.style.opacity = '0';
    }
  }

  function gameOver() {
    running = false; setStatus('GAME OVER', false);
    if (score > best) { best = score; localStorage.setItem('neonDodgeBest', best); }
    updateHud();
    showOverlay('PARTIE TERMINÉE', `Score : <b>${score}</b><br>Atteins le niveau ${level + 1} pour aller plus loin.`, 'REJOUER <span>→</span>');
    burst(player.x, player.y);
  }
  function start() {
    reset(); running = true; setStatus('EN JEU', true);
    hideOverlay();
    lastTime = performance.now(); requestAnimationFrame(loop);
  }
  if (startBtn) startBtn.addEventListener('click', start);

  function movePlayer(dt) {
    let dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    let dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 1);
    player.x = Math.max(13, Math.min(width - 13, player.x + dx * player.speed * dt));
    player.y = Math.max(18, Math.min(height - 18, player.y + dy * player.speed * dt));
  }
  window.addEventListener('keydown', e => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'd', 'w', 's'].includes(e.key)) e.preventDefault();
    if (e.key === 'ArrowLeft' || e.key === 'a') keys.left = true;
    if (e.key === 'ArrowRight' || e.key === 'd') keys.right = true;
    if (e.key === 'ArrowUp' || e.key === 'w') keys.up = true;
    if (e.key === 'ArrowDown' || e.key === 's') keys.down = true;
    if (e.key === ' ' && !running) start();
  });
  window.addEventListener('keyup', e => {
    if (e.key === 'ArrowLeft' || e.key === 'a') keys.left = false;
    if (e.key === 'ArrowRight' || e.key === 'd') keys.right = false;
    if (e.key === 'ArrowUp' || e.key === 'w') keys.up = false;
    if (e.key === 'ArrowDown' || e.key === 's') keys.down = false;
  });
  let touchX = null, touchY = null;
  canvas.addEventListener('pointerdown', e => { touchX = e.clientX; touchY = e.clientY; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => { if (touchX === null) return; const r = canvas.getBoundingClientRect(); player.x = Math.max(13, Math.min(width - 13, e.clientX - r.left)); player.y = Math.max(18, Math.min(height - 18, e.clientY - r.top)); });
  canvas.addEventListener('pointerup', () => { touchX = touchY = null; });

  function update(dt) {
    elapsed += dt;
    const newLevel = Math.floor(elapsed / 10) + 1;
    if (newLevel !== level) { level = newLevel; updateHud(); burst(player.x, player.y, '#52f7ff'); }
    score = Math.floor(elapsed * (difficulty === 'easy' ? .7 : difficulty === 'hard' ? 1.8 : 1));
    meteorTimer -= dt;
    const interval = level < 3 ? .72 : Math.max(.38, .92 - level * .045);
    if (meteorTimer <= 0) { spawnMeteor(); if (level >= 4 && Math.random() < .28) spawnMeteor(); meteorTimer = interval; }
    laserTimer -= dt;
    if (level >= 5 && laserTimer <= 0) { spawnLaser(); laserTimer = Math.max(.42, 1.15 - level * .035); }
    movePlayer(dt);
    meteors.forEach(m => { m.y += m.speed * dt; m.x += m.drift * dt; m.angle += m.spin * dt; });
    lasers.forEach(l => { l.x += l.vx * dt; l.y += l.vy * dt; });
    meteors = meteors.filter(m => m.y < height + m.r + 10 && m.x > -m.r - 20 && m.x < width + m.r + 20);
    lasers = lasers.filter(l => l.x > -60 && l.x < width + 60 && l.y > -60 && l.y < height + 60);
    particles.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }); particles = particles.filter(p => p.life > 0);
    for (const m of meteors) if (hitCircle(m.x, m.y, m.r * .78)) return gameOver();
    for (const l of lasers) if (hitLaser(l)) return gameOver();
    updateHud();
  }
  function draw() {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#090d1f'; ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(82,247,255,.055)'; ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
    for (let y = 0; y < height; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
    lasers.forEach(l => { ctx.shadowBlur = 16; ctx.shadowColor = '#ff3d81'; ctx.fillStyle = '#ff3d81'; ctx.fillRect(l.x - l.w / 2, l.y - l.h / 2, l.w, l.h); ctx.shadowBlur = 0; });
    meteors.forEach(m => { ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(m.angle); ctx.shadowBlur = 12; ctx.shadowColor = '#ff3d81'; ctx.fillStyle = m.r > 15 ? '#bd245e' : '#ff3d81'; ctx.beginPath(); ctx.moveTo(0, -m.r); ctx.lineTo(m.r * .8, 0); ctx.lineTo(0, m.r); ctx.lineTo(-m.r * .8, 0); ctx.closePath(); ctx.fill(); ctx.restore(); });
    ctx.save(); ctx.translate(player.x, player.y); ctx.shadowBlur = 18; ctx.shadowColor = '#52f7ff'; ctx.fillStyle = '#52f7ff'; ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(12, 13); ctx.lineTo(0, 7); ctx.lineTo(-12, 13); ctx.closePath(); ctx.fill(); ctx.restore();
    particles.forEach(p => { ctx.globalAlpha = Math.max(0, p.life * 2); ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, 3, 3); }); ctx.globalAlpha = 1;
  }
  function loop(now) { if (!running) { draw(); return; } const dt = Math.min((now - lastTime) / 1000, .05); lastTime = now; update(dt); draw(); if (running) requestAnimationFrame(loop); }
  showOverlay('PRÊT À JOUER ?', 'Évite les météores rouges.<br>Chaque niveau rapporte des points.', 'LANCER LA PARTIE <span>→</span>');
  setDifficulty('normal'); updateHud(); draw();
})();
