const COLS = 7;
const ROWS = 6;
const HEIGHT = ROWS + 1; // bitboard stride
const MOVE_ORDER = [3, 2, 4, 1, 5, 0, 6];
const WIN_SCORE = 1_000_000;
const SEARCH_TIME_MS = 1400;

const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");
const overlay = document.getElementById("menu-overlay");
const toastEl = document.getElementById("toast");
const modeLabel = document.getElementById("mode-label");
const turnLabel = document.getElementById("turn-label");
const statusLabel = document.getElementById("status-label");
const botLabel = document.getElementById("bot-label");

const startBotBtn = document.getElementById("play-bot");
const startPvpBtn = document.getElementById("play-pvp");
const undoBtn = document.getElementById("undo-btn");
const restartBtn = document.getElementById("restart-btn");
const homeBtn = document.getElementById("home-btn");

const colors = {
  bg: "#0c1224",
  boardLight: "#1a233a",
  boardDark: "#0d1527",
  grid: "#0c162d",
  player1: "#ef4444", // red
  player2: "#34d399", // green
  star: "#fdfdfd",
  highlight: "rgba(90, 240, 217, 0.7)",
};

const state = {
  grid: createGrid(),
  playerBoards: [0n, 0n],
  heights: Array(COLS).fill(0),
  currentPlayer: 1,
  gameType: "menu", // "bot" | "pvp"
  status: "menu", // "menu" | "playing" | "won" | "draw"
  winner: null,
  hoverCol: -1,
  aiThinking: false,
  history: [],
  lastMove: null,
  anim: null,
};

const winningMasks = buildWinningMasks();
const centerMask = buildCenterMask();
const tt = new Map();

function createGrid() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

function resetGame(gameType) {
  state.grid = createGrid();
  state.playerBoards = [0n, 0n];
  state.heights = Array(COLS).fill(0);
  state.currentPlayer = 1;
  state.gameType = gameType;
  state.status = "playing";
  state.winner = null;
  state.hoverCol = -1;
  state.aiThinking = false;
  state.history = [];
  state.lastMove = null;
  state.anim = null;
  overlay.classList.add("hidden");
  updateHud();
  render();
  if (gameType === "bot" && state.currentPlayer === 2) {
    aiTurn();
  }
}

function backToMenu() {
  state.status = "menu";
  state.gameType = "menu";
  overlay.classList.remove("hidden");
  updateHud();
  render();
}

startBotBtn.addEventListener("click", () => resetGame("bot"));
startPvpBtn.addEventListener("click", () => resetGame("pvp"));
restartBtn.addEventListener("click", () => {
  if (state.gameType === "menu") return;
  resetGame(state.gameType);
});
homeBtn.addEventListener("click", backToMenu);

undoBtn.addEventListener("click", () => {
  if (state.gameType !== "bot") return;
  undoPlayerTurn();
});

canvas.addEventListener("mousemove", (e) => {
  const col = getColumnFromEvent(e);
  state.hoverCol = col;
  render();
});

canvas.addEventListener("mouseleave", () => {
  state.hoverCol = -1;
  render();
});

canvas.addEventListener("click", (e) => {
  if (state.status !== "playing" || state.aiThinking) return;
  const col = getColumnFromEvent(e);
  if (col < 0 || col >= COLS) return;
  if (state.gameType === "bot" && state.currentPlayer === 2) return;
  handleMove(col);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "f") {
    toggleFullscreen();
  } else if (e.key === "u") {
    if (state.gameType === "bot") undoPlayerTurn();
  } else if (e.key === "r") {
    if (state.gameType !== "menu") resetGame(state.gameType);
  }
});

window.addEventListener("resize", resizeCanvas);
resizeCanvas();
render();
updateHud();

function getColumnFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const usableWidth = rect.width;
  const pad = usableWidth * 0.05;
  const boardWidth = usableWidth - pad * 2;
  const cell = boardWidth / COLS;
  const col = Math.floor((x - pad) / cell);
  if (x < pad || x > pad + boardWidth) return -1;
  return col;
}

function handleMove(col) {
  if (!canPlayColumn(state, col) || state.status !== "playing") return;
  const row = state.heights[col];
  placePiece(col, row, state.currentPlayer);
  const justPlayed = state.currentPlayer;
  state.lastMove = { col, row, player: justPlayed };
  state.history.push({ col, row, player: justPlayed, bit: bitAt(col, row) });
  state.currentPlayer = 3 - state.currentPlayer;

  if (isWinningBoard(state.playerBoards[justPlayed - 1])) {
    state.status = "won";
    state.winner = justPlayed;
    showToast(`Player ${justPlayed} wins!`);
  } else if (state.history.length === COLS * ROWS) {
    state.status = "draw";
    showToast("Board is full. Draw.");
  }

  updateHud();
  render();

  if (state.status === "playing" && state.gameType === "bot" && state.currentPlayer === 2) {
    aiTurn();
  }
}

function undoPlayerTurn() {
  if (state.history.length === 0 || state.gameType !== "bot") return;
  // remove bot reply if present
  state.aiThinking = false;
  undoMove();
  if (state.currentPlayer === 2 && state.history.length > 0) {
    undoMove();
  }
  state.status = "playing";
  state.winner = null;
  updateHud();
  render();
  showToast("Undid your last turn.");
}

function undoMove() {
  const last = state.history.pop();
  if (!last) return;
  state.currentPlayer = last.player;
  state.heights[last.col] -= 1;
  state.grid[last.row][last.col] = 0;
  state.playerBoards[last.player - 1] &= ~last.bit;
  state.lastMove = state.history[state.history.length - 1] || null;
}

function placePiece(col, row, player) {
  state.grid[row][col] = player;
  state.heights[col] += 1;
  state.playerBoards[player - 1] |= bitAt(col, row);
  state.anim = {
    col,
    row,
    player,
    start: performance.now(),
    duration: 450,
  };
}

function canPlayColumn(s, col) {
  return s.heights[col] < ROWS;
}

function bitAt(col, row) {
  return 1n << BigInt(col * HEIGHT + row);
}

function aiTurn() {
  state.aiThinking = true;
  updateHud();
  render();
  const snapshot = {
    boards: [...state.playerBoards],
    heights: [...state.heights],
    current: state.currentPlayer - 1,
    moves: [...state.history],
  };
  const start = performance.now();
  const minDelay = 500 + Math.random() * 500; // 0.5–1.0s
  const best = findBestMove(snapshot, SEARCH_TIME_MS);
  const searchElapsed = performance.now() - start;
  const waitTime = Math.max(0, minDelay - searchElapsed);
  setTimeout(() => {
    state.aiThinking = false;
    if (state.status !== "playing" || state.currentPlayer !== 2) {
      render();
      updateHud();
      return;
    }
    handleMove(best ?? pickFallbackMove());
    const elapsed = performance.now() - start;
    statusLabel.textContent = `Bot searched depth ${lastSearchDepth} in ${elapsed.toFixed(0)}ms`;
  }, waitTime);
}

function pickFallbackMove() {
  for (const c of MOVE_ORDER) {
    if (canPlayColumn(state, c)) return c;
  }
  return 0;
}

let lastSearchDepth = 0;

function findBestMove(snapshot, budgetMs) {
  lastSearchDepth = 0;
  const search = {
    boards: [...snapshot.boards],
    heights: [...snapshot.heights],
    current: snapshot.current,
    moves: snapshot.moves.map((m) => ({ col: m.col, bit: m.bit, player: m.player })),
  };
  const deadline = performance.now() + budgetMs;
  let bestMove = MOVE_ORDER.find((c) => canPlay(search, c));
  let bestScore = -Infinity;
  for (let depth = 2; depth <= 12; depth++) {
    const res = negamax(search, depth, -WIN_SCORE, WIN_SCORE, deadline, 0);
    if (res.timeout) break;
    lastSearchDepth = depth;
    if (res.move !== null && res.score > bestScore) {
      bestScore = res.score;
      bestMove = res.move;
    }
    if (bestScore >= WIN_SCORE - 10) break; // forced win found
  }
  return bestMove;
}

function canPlay(search, col) {
  return search.heights[col] < ROWS;
}

function makeMove(search, col) {
  const row = search.heights[col];
  const bit = 1n << BigInt(col * HEIGHT + row);
  search.boards[search.current] |= bit;
  search.heights[col] += 1;
  search.moves.push({ col, bit });
  search.current ^= 1;
  return { row, bit };
}

function undoSearchMove(search) {
  const last = search.moves.pop();
  if (!last) return;
  search.current ^= 1;
  search.heights[last.col] -= 1;
  search.boards[search.current] &= ~last.bit;
}

function negamax(search, depth, alpha, beta, deadline, ply) {
  if (performance.now() > deadline) return { timeout: true, score: 0, move: null };
  const lastPlayer = search.current ^ 1;
  if (search.moves.length && isWinningBoard(search.boards[lastPlayer])) {
    return { score: -WIN_SCORE + ply, move: null, timeout: false };
  }
  if (search.moves.length === COLS * ROWS) return { score: 0, move: null, timeout: false };
  if (depth === 0) return { score: evaluate(search), move: null, timeout: false };

  const key = ttKey(search);
  const entry = tt.get(key);
  let moveList = [...MOVE_ORDER];
  if (entry && entry.depth >= depth) {
    return { score: entry.score, move: entry.bestMove, timeout: false };
  }
  if (entry && entry.bestMove !== null) {
    moveList = [entry.bestMove, ...MOVE_ORDER.filter((c) => c !== entry.bestMove)];
  }

  let bestMove = null;
  let bestScore = -WIN_SCORE;

  for (const col of moveList) {
    if (!canPlay(search, col)) continue;
    const { bit } = makeMove(search, col);
    const lastBoard = search.boards[search.current ^ 1];
    let score;
    if (isWinningBoard(lastBoard)) {
      score = WIN_SCORE - ply;
    } else {
      const res = negamax(search, depth - 1, -beta, -alpha, deadline, ply + 1);
      if (res.timeout) {
        undoSearchMove(search);
        return res;
      }
      score = -res.score;
    }
    undoSearchMove(search);

    if (score > bestScore) {
      bestScore = score;
      bestMove = col;
    }
    alpha = Math.max(alpha, score);
    if (alpha >= beta) break;
  }

  tt.set(key, { depth, score: bestScore, bestMove });
  return { score: bestScore, move: bestMove, timeout: false };
}

function evaluate(search) {
  const me = search.boards[search.current];
  const opp = search.boards[search.current ^ 1];
  let score = 0;

  for (const mask of winningMasks) {
    const myCount = popcount(me & mask);
    const oppCount = popcount(opp & mask);
    if (myCount && oppCount) continue;
    if (myCount === 0 && oppCount === 0) continue;
    const weights = [0, 2, 8, 40, 0];
    score += weights[myCount];
    score -= weights[oppCount];
  }

  const centerWeight = 3;
  score += centerWeight * popcount(me & centerMask);
  score -= centerWeight * popcount(opp & centerMask);
  return score;
}

function popcount(n) {
  let c = 0;
  let x = n;
  while (x) {
    x &= x - 1n;
    c++;
  }
  return c;
}

function ttKey(search) {
  return `${search.boards[0].toString(16)}|${search.boards[1].toString(16)}|${search.current}`;
}

function buildWinningMasks() {
  const masks = [];
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      if (c <= COLS - 4) {
        masks.push(lineMask([
          [c, r],
          [c + 1, r],
          [c + 2, r],
          [c + 3, r],
        ]));
      }
      if (r <= ROWS - 4) {
        masks.push(lineMask([
          [c, r],
          [c, r + 1],
          [c, r + 2],
          [c, r + 3],
        ]));
      }
      if (c <= COLS - 4 && r <= ROWS - 4) {
        masks.push(lineMask([
          [c, r],
          [c + 1, r + 1],
          [c + 2, r + 2],
          [c + 3, r + 3],
        ]));
      }
      if (c <= COLS - 4 && r >= 3) {
        masks.push(lineMask([
          [c, r],
          [c + 1, r - 1],
          [c + 2, r - 2],
          [c + 3, r - 3],
        ]));
      }
    }
  }
  return masks;
}

function lineMask(coords) {
  return coords.reduce((mask, [c, r]) => mask | bitAt(c, r), 0n);
}

function buildCenterMask() {
  let mask = 0n;
  for (let r = 0; r < ROWS; r++) {
    mask |= bitAt(3, r);
  }
  return mask;
}

function isWinningBoard(board) {
  const dirs = [1n, 7n, 6n, 8n];
  for (const d of dirs) {
    const m = board & (board >> d);
    if (m & (m >> (2n * d))) return true;
  }
  return false;
}

function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  render();
}

function render() {
  const dpr = window.devicePixelRatio || 1;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  const pad = width * 0.05;
  const boardWidth = width - pad * 2;
  const boardHeight = height - pad * 2;
  const cellSize = Math.min(boardWidth / COLS, boardHeight / ROWS);
  const offsetX = pad + (boardWidth - cellSize * COLS) / 2;
  const offsetY = pad + (boardHeight - cellSize * ROWS) / 2;

  const bgGradient = ctx.createLinearGradient(0, 0, width, height);
  bgGradient.addColorStop(0, "#0a0f1f");
  bgGradient.addColorStop(1, "#0b132b");
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, width, height);

  const boardRadius = 18;
  ctx.fillStyle = colors.boardDark;
  roundRect(ctx, offsetX - 14, offsetY - 14, cellSize * COLS + 28, cellSize * ROWS + 28, boardRadius);
  ctx.fill();

  ctx.save();
  ctx.translate(offsetX, offsetY);
  drawGrid(cellSize);
  drawPieces(cellSize, offsetX, offsetY);
  drawHover(cellSize, offsetX, offsetY);
  ctx.restore();

  if (state.status === "won" || state.status === "draw") {
    drawEndBanner(width, height);
  }
  ctx.restore();
  if (state.anim) {
    const now = performance.now();
    const t = Math.min(1, (now - state.anim.start) / state.anim.duration);
    if (t < 1) {
      requestAnimationFrame(render);
    } else {
      state.anim = null;
    }
  }
}

function drawGrid(cell) {
  ctx.fillStyle = colors.boardLight;
  roundRect(ctx, 0, 0, cell * COLS, cell * ROWS, 14);
  ctx.fill();
  ctx.globalCompositeOperation = "destination-out";
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      ctx.beginPath();
      ctx.arc(c * cell + cell / 2, (ROWS - 1 - r) * cell + cell / 2, cell * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalCompositeOperation = "source-over";
}

function drawPieces(cell, offsetX, offsetY) {
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const player = state.grid[r][c];
      if (player === 0) continue;
      if (state.anim && state.anim.col === c && state.anim.row === r) continue;
      const x = c * cell + cell / 2;
      const y = (ROWS - 1 - r) * cell + cell / 2;
      drawDisc(x, y, cell, player, state.lastMove && state.lastMove.col === c && state.lastMove.row === r);
    }
  }
  if (state.anim) {
    const { col, row, player, start, duration } = state.anim;
    const x = col * cell + cell / 2;
    const targetY = (ROWS - 1 - row) * cell + cell / 2;
  const startY = -cell * 1.2;
    const now = performance.now();
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const y = startY + (targetY - startY) * eased;
    drawDisc(x, y, cell, player, true);
  }
}

function drawHover(cell, offsetX, offsetY) {
  if (state.status !== "playing" || state.aiThinking) return;
  if (state.hoverCol < 0 || state.hoverCol >= COLS) return;
  if (!canPlayColumn(state, state.hoverCol)) return;
  const c = state.hoverCol;
  const r = state.heights[c];
  const y = (ROWS - 1 - r) * cell + cell / 2;
  const x = c * cell + cell / 2;
  ctx.strokeStyle = colors.highlight;
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  ctx.arc(x, y, cell * 0.42, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawDisc(x, y, cell, player, highlight) {
  const color = player === 1 ? colors.player1 : colors.player2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, cell * 0.42, 0, Math.PI * 2);
  ctx.fill();
  if (highlight) {
    ctx.strokeStyle = colors.highlight;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, cell * 0.47, 0, Math.PI * 2);
    ctx.stroke();
  }
  drawStar(x, y, cell * 0.18, player === 1 ? 5 : 6);
}

function drawStar(cx, cy, radius, points) {
  const inner = radius * 0.5;
  ctx.fillStyle = colors.star;
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? radius : inner;
    const a = (i * Math.PI) / points;
    const x = cx + r * Math.cos(a - Math.PI / 2);
    const y = cy + r * Math.sin(a - Math.PI / 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function drawEndBanner(width, height) {
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(0, height * 0.35, width, 120);
  ctx.fillStyle = "#fff";
  ctx.font = "32px 'Segoe UI', 'Avenir Next', sans-serif";
  ctx.textAlign = "center";
  let text = "Draw game";
  if (state.status === "won") {
    if (state.gameType === "bot") {
      text = state.winner === 1 ? "You beat the bot!" : "Bot wins!";
    } else {
      text = state.winner === 1 ? "Player 1 wins!" : "Player 2 wins!";
    }
  }
  ctx.fillText(text, width / 2, height * 0.35 + 64);
}

function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function updateHud() {
  modeLabel.textContent =
    state.gameType === "bot" ? "Bot duel" : state.gameType === "pvp" ? "Two player" : "Menu";
  turnLabel.textContent =
    state.status === "playing" ? (state.currentPlayer === 1 ? "Player 1 (red)" : "Player 2 (gold)") : "—";
  botLabel.textContent = "Iterative deepening α-β";
  if (state.status === "won") {
    if (state.gameType === "bot") {
      statusLabel.textContent = state.winner === 1 ? "You beat the bot!" : "Bot wins!";
    } else {
      statusLabel.textContent = `Player ${state.winner} wins`;
    }
  } else if (state.status === "draw") {
    statusLabel.textContent = "Draw";
  } else if (state.aiThinking) {
    statusLabel.textContent = "Bot is calculating…";
  } else if (state.status === "playing") {
    statusLabel.textContent = "Your move";
  } else {
    statusLabel.textContent = "Waiting to start";
  }
  undoBtn.disabled = state.gameType !== "bot" || state.history.length === 0;
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    canvas.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

function showToast(text) {
  toastEl.textContent = text;
  toastEl.classList.add("visible");
  setTimeout(() => toastEl.classList.remove("visible"), 1600);
}

window.render_game_to_text = () => {
  const payload = {
    mode: state.status,
    gameType: state.gameType,
    currentPlayer: state.currentPlayer,
    winner: state.winner,
    moves: state.history.length,
    board: state.grid.map((row, r) => ({
      rowIndex: r,
      cells: row,
    })),
    availableColumns: state.heights.map((h, idx) => (h < ROWS ? idx : null)).filter((v) => v !== null),
    note: "Rows indexed from bottom = 0, columns from left = 0.",
  };
  return JSON.stringify(payload);
};

window.advanceTime = (ms) => {
  const steps = Math.max(1, Math.round(ms / (1000 / 60)));
  for (let i = 0; i < steps; i++) {
    // deterministic hook; no time-based state yet
  }
  render();
};
