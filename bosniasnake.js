import React, { useEffect, useRef, useState } from "react";
import Peer from "peerjs";

// --- FIREBASE IMPORTS ---
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  addDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  where,
  getDocs,
  updateDoc,
  doc,
} from "firebase/firestore";

// --- AUDIO ENGINE (Procedural SFX) ---
const audioCtx =
  typeof window !== "undefined"
    ? new (window.AudioContext || window.webkitAudioContext)()
    : null;

function playSound(type) {
  if (!audioCtx) return;
  if (audioCtx.state === "suspended") audioCtx.resume();

  const now = audioCtx.currentTime;
  const gainNode = audioCtx.createGain();
  gainNode.connect(audioCtx.destination);

  if (type === "eat") {
    const osc = audioCtx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.exponentialRampToValueAtTime(1000, now + 0.1);

    osc.connect(gainNode);
    gainNode.gain.setValueAtTime(0.05, now);
    gainNode.gain.linearRampToValueAtTime(0.01, now + 0.1);

    osc.start(now);
    osc.stop(now + 0.1);
  } else if (type === "soviet_boom") {
    const bufferSize = audioCtx.sampleRate * 1.5;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;

    const filter = audioCtx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(800, now);
    filter.frequency.exponentialRampToValueAtTime(10, now + 1);

    noise.connect(filter);
    filter.connect(gainNode);

    gainNode.gain.setValueAtTime(0.8, now);
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 1);

    noise.start(now);
    noise.stop(now + 1.5);
  } else if (type === "angelic") {
    const freqs = [523.25, 659.25, 783.99];
    freqs.forEach((f, i) => {
      const osc = audioCtx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = f;
      if (i === 1) osc.detune.value = 5;
      if (i === 2) osc.detune.value = -5;

      osc.connect(gainNode);
      osc.start(now);
      osc.stop(now + 2.5);
    });

    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.08, now + 0.5);
    gainNode.gain.linearRampToValueAtTime(0, now + 2.5);
  }
}

// --- FIREBASE CONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyDfTRtLoB37SCPgAcQsxjmcuSPOHThuHNk",
  authDomain: "bosniasnake.firebaseapp.com",
  projectId: "bosniasnake",
  storageBucket: "bosniasnake.firebasestorage.app",
  messagingSenderId: "246754109806",
  appId: "1:246754109806:web:c58a4820f26478b69ab97f",
  measurementId: "G-FFQ2PJ3X5W",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// --- GAMEPLAY CONFIGURATION ---
const OWNER_PASSWORD = "Roblox13_isme";
const CELL = 150;
const GRID = 80;
const WORLD_SIZE = CELL * GRID;
const MIN_LENGTH = 140;
const SPRINT_COST = 0.5;
const BASE_SPEED = 4.2;
const TURN_SPEED = 0.09;
const MAX_ENEMIES = 8;
const SIZE_GAIN_PER_LEVEL = 0.25;
const FOOD_RADIUS_BASE = 6;
const LENGTH_GAIN = 8;
const BROADCAST_RATE = 50;
const INTERPOLATION_SPEED = 0.2;

const SKINS_NORMAL = [
  "bosnia",
  "russia",
  "germany",
  "france",
  "canada",
  "ukraine",
];
const SKINS_SPECIAL = ["ireland", "soviet", "golden_maple"];
const ALL_SKINS = [...SKINS_NORMAL, ...SKINS_SPECIAL];

const SKIN_BODY_COLORS = {
  bosnia: "#002F6C",
  russia: "#FFFFFF",
  germany: "#000000",
  france: "#0055A4",
  canada: "#FF0000",
  ukraine: "#0057B8",
  ireland: "#169B62",
  soviet: "#CC0000",
  golden_maple: "#DAA520",
};

const UNLOCK_CRITERIA = {
  bosnia: { type: "default", label: "Default" },
  russia: { type: "scale", val: 50, label: "Reach Size 50" },
  germany: { type: "scale", val: 40, label: "Reach Size 40" },
  france: { type: "deaths", val: 5, label: "Die 5 Times" },
  canada: { type: "length", val: 1000, label: "Reach Length 1k" },
  ukraine: { type: "games", val: 5, label: "Play 5 Games" },
  ireland: { type: "code", label: "Secret Code" },
  soviet: { type: "custom_soviet", label: "Russia + Size 500 + 50 Kills" },
  golden_maple: {
    type: "custom_maple",
    label: "Canada + Size 250 + 150 Kills",
  },
};

function randPosCell() {
  return Math.floor(Math.random() * GRID) * CELL - WORLD_SIZE / 2;
}
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function coll(a, b, r) {
  return dist(a, b) < r;
}
function normalizeAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
function lerp(start, end, t) {
  return start * (1 - t) + end * t;
}
function lerpAngle(a, b, t) {
  const da = (b - a) % (2 * Math.PI);
  const twoD = ((2 * da) % (2 * Math.PI)) - da;
  return a + twoD * t;
}

export default function BosniaSnakeLiveCounter() {
  const canvasRef = useRef(null);

  // --- UI STATES ---
  const [menuState, setMenuState] = useState("start");
  const [controlMode, setControlMode] = useState("mouse");
  const [skinCategory, setSkinCategory] = useState("normal");
  const [selectedSkin, setSelectedSkin] = useState("bosnia");
  const [myId, setMyId] = useState("Generating...");
  const [connectId, setConnectId] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [lobbyCount, setLobbyCount] = useState(1);
  const [myPlayerIndex, setMyPlayerIndex] = useState(0);
  const [isConnecting, setIsConnecting] = useState(false);
  const [showMultiMenu, setShowMultiMenu] = useState(false);
  const [playerName, setPlayerName] = useState("");
  const [leaderboard, setLeaderboard] = useState([]);
  const [redeemCode, setRedeemCode] = useState("");

  // --- SPECTATOR STATES ---
  const [showSpectateBrowser, setShowSpectateBrowser] = useState(false);
  const [activeGames, setActiveGames] = useState([]); 
  const [isSpectating, setIsSpectating] = useState(false);
  const [spectateTargetIndex, setSpectateTargetIndex] = useState(0);

  // Owner States
  const [showOwnerLogin, setShowOwnerLogin] = useState(false);
  const [showOwnerPanel, setShowOwnerPanel] = useState(false);
  const [ownerPasswordInput, setOwnerPasswordInput] = useState("");
  const [cheatMsg, setCheatMsg] = useState("");

  // --- STATS ---
  const [userStats, setUserStats] = useState({
    totalKills: 0,
    totalDeaths: 0,
    bestScale: 18,
    bestLength: 140,
    gamesPlayed: 0,
    unlockedSecrets: [],
  });

  const cheats = useRef({ godMode: false, speedHack: false });
  const peerRef = useRef(null);
  const connections = useRef([]);
  const hostConn = useRef(null);
  const lastSentTime = useRef(0);
  const serverState = useRef(null);
  const mouse = useRef({ x: 0, y: 0 });
  const keys = useRef({});
  const remoteInputs = useRef({});
  const lastInputSent = useRef(null);
  const lobbyHeartbeat = useRef(null);

  const gameState = useRef({
    mode: null,
    players: [],
    enemies: [],
    food: [],
    mines: [],
    explosions: [],
    syrupZones: [],
    shakeIntensity: 0,
    gameOver: false,
  });

  // --- DATA LOADING & LOBBIES ---
  useEffect(() => {
    try {
      const savedStats = localStorage.getItem("bosnia_snake_stats_v2");
      if (savedStats) setUserStats(JSON.parse(savedStats));

      const savedName = localStorage.getItem("bosnia_snake_username");
      if (savedName) setPlayerName(savedName);
      else setPlayerName("Player" + Math.floor(Math.random() * 999));
    } catch (e) {
      console.error(e);
    }

    const q = query(collection(db, "leaderboard"), orderBy("size", "desc"), limit(5));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const lbData = snapshot.docs.map((doc) => doc.data());
      setLeaderboard(lbData);
    });
    
    // --- LIVE ACTIVE GAMES LISTENER ---
    const qLobby = query(collection(db, "lobbies"), orderBy("timestamp", "desc"));
    const unsubLobby = onSnapshot(qLobby, (snapshot) => {
        const now = Date.now();
        const games = [];
        snapshot.forEach(doc => {
            const d = doc.data();
            // Safety check: sometimes timestamp is null on immediate write
            const time = d.timestamp ? d.timestamp.toMillis() : now;
            // Filter stale games (inactive for > 40s)
            if (now - time < 40000) {
                games.push({ id: doc.id, ...d });
            }
        });
        setActiveGames(games);
    });

    // --- REFRESH COUNTER INTERVAL (Every 5 seconds to prune stale games) ---
    const refreshInterval = setInterval(() => {
        setActiveGames(prev => {
            const now = Date.now();
            return prev.filter(g => {
                const time = g.timestamp ? g.timestamp.toMillis() : now;
                return now - time < 40000; // 40s buffer
            });
        });
    }, 5000);

    return () => {
        unsubscribe();
        unsubLobby();
        clearInterval(refreshInterval);
        if (lobbyHeartbeat.current) clearInterval(lobbyHeartbeat.current);
    };
  }, []);

  const handleNameChange = (e) => {
    setPlayerName(e.target.value);
    localStorage.setItem("bosnia_snake_username", e.target.value);
  };

  const publishLobbyPresence = async (peerId, mode, currentSize = 18) => {
      if (!peerId) return;
      const lobbyData = {
          hostName: playerName,
          mode: mode,
          size: currentSize,
          players: connections.current.length + 1,
          timestamp: serverTimestamp()
      };
      try {
        await setDoc(doc(db, "lobbies", peerId), lobbyData);
      } catch(e) { console.error("Lobby publish error", e); }
  };

  const startHeartbeat = (peerId, mode) => {
      if (lobbyHeartbeat.current) clearInterval(lobbyHeartbeat.current);
      publishLobbyPresence(peerId, mode);
      lobbyHeartbeat.current = setInterval(() => {
          const myPlayer = gameState.current.players[0]; 
          const size = myPlayer ? myPlayer.scale : 18;
          publishLobbyPresence(peerId, mode, size);
      }, 5000); // Send heartbeat every 5s
  };

  const cleanupPresence = async () => {
      if (lobbyHeartbeat.current) clearInterval(lobbyHeartbeat.current);
      if (peerRef.current && peerRef.current.id) {
          try {
             await deleteDoc(doc(db, "lobbies", peerRef.current.id));
          } catch(e) {}
      }
  };

  const submitScoreToLeaderboard = async (finalScale) => {
    try {
      const name = playerName.trim() || "Anonymous";
      if (finalScale < 20) return;
      const size = parseFloat(finalScale.toFixed(2));
      const leaderboardRef = collection(db, "leaderboard");
      const q = query(leaderboardRef, where("name", "==", name));
      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        await addDoc(leaderboardRef, {
          name,
          size,
          timestamp: serverTimestamp(),
        });
      } else {
        const existingDoc = querySnapshot.docs[0];
        const oldSize = existingDoc.data().size;
        if (size > oldSize) {
          const docRef = doc(db, "leaderboard", existingDoc.id);
          await updateDoc(docRef, { size, timestamp: serverTimestamp() });
        }
      }
    } catch (err) {
      console.error("Error submitting score:", err);
    }
  };

  const updateStats = (updates) => {
    setUserStats((prev) => {
      const next = { ...prev };
      let changed = false;
      if (updates.kill) { next.totalKills++; changed = true; }
      if (updates.death) { next.totalDeaths++; changed = true; }
      if (updates.game) { next.gamesPlayed++; changed = true; }
      if (updates.unlockSecret && !next.unlockedSecrets.includes(updates.unlockSecret)) {
        next.unlockedSecrets.push(updates.unlockSecret);
        changed = true;
      }
      if (updates.scale && updates.scale > next.bestScale) {
        next.bestScale = updates.scale;
        changed = true;
      }
      if (updates.length && updates.length > next.bestLength) {
        next.bestLength = updates.length;
        changed = true;
      }
      if (changed) {
        localStorage.setItem("bosnia_snake_stats_v2", JSON.stringify(next));
        return next;
      }
      return prev;
    });
  };

  const isSkinUnlocked = (skin) => {
    const req = UNLOCK_CRITERIA[skin];
    if (skin === "soviet") return isSkinUnlocked("russia") && userStats.bestScale >= 500 && userStats.totalKills >= 50;
    if (skin === "golden_maple") return isSkinUnlocked("canada") && userStats.bestScale >= 250 && userStats.totalKills >= 150;
    if (req.type === "default") return true;
    if (req.type === "code") return userStats.unlockedSecrets && userStats.unlockedSecrets.includes(skin);
    if (req.type === "kills") return userStats.totalKills >= req.val;
    if (req.type === "deaths") return userStats.totalDeaths >= req.val;
    if (req.type === "scale") return userStats.bestScale >= req.val;
    if (req.type === "length") return userStats.bestLength >= req.val;
    if (req.type === "games") return userStats.gamesPlayed >= req.val;
    return false;
  };

  const handleRedeemCode = () => {
    if (redeemCode === "Ireland_isgreat") {
      if (!isSkinUnlocked("ireland")) {
        updateStats({ unlockSecret: "ireland" });
        alert("SUCCESS: Ireland Skin Unlocked!");
        setSkinCategory("special");
        setSelectedSkin("ireland");
      } else alert("Already unlocked!");
    } else alert("Invalid Code");
    setRedeemCode("");
  };

  useEffect(() => {
    if (!isSkinUnlocked(selectedSkin)) setSelectedSkin("bosnia");
  }, [userStats]);

  useEffect(() => {
    if (!CanvasRenderingContext2D.prototype.roundRect) {
      // @ts-ignore
      CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
        if (w < 2 * r) r = w / 2;
        if (h < 2 * r) r = h / 2;
        this.beginPath();
        this.moveTo(x + r, y);
        this.arcTo(x + w, y, x + w, y + h, r);
        this.arcTo(x + w, y + h, x, y + h, r);
        this.arcTo(x, y + h, x, y, r);
        this.arcTo(x, y, x + w, y, r);
        this.closePath();
        return this;
      };
    }
    const handleDown = (e) => {
      if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
      if (e.key === "`" || e.key === "~") {
        e.preventDefault();
        if (showOwnerPanel) setShowOwnerPanel(false);
        else setShowOwnerLogin((p) => !p);
        return;
      }
      if (isSpectating) {
        if (e.key === "ArrowLeft") cycleSpectatorTarget(-1);
        if (e.key === "ArrowRight") cycleSpectatorTarget(1);
      }
      keys.current[e.key.toLowerCase()] = true;
    };
    const handleUp = (e) => {
      keys.current[e.key.toLowerCase()] = false;
    };
    const handleMouseMove = (e) => {
      mouse.current.x = e.clientX;
      mouse.current.y = e.clientY;
    };
    const handleTouchStart = (e) => {
      if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
      mouse.current.x = e.touches[0].clientX;
      mouse.current.y = e.touches[0].clientY;
    };
    const handleTouchMove = (e) => {
      mouse.current.x = e.touches[0].clientX;
      mouse.current.y = e.touches[0].clientY;
      if (e.target === canvasRef.current) e.preventDefault();
    };

    window.addEventListener("keydown", handleDown);
    window.addEventListener("keyup", handleUp);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("touchstart", handleTouchStart, { passive: false });
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    return () => {
      window.removeEventListener("keydown", handleDown);
      window.removeEventListener("keyup", handleUp);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      if (peerRef.current) { cleanupPresence(); peerRef.current.destroy(); }
    };
  }, [showOwnerPanel, isSpectating]);

  const cycleSpectatorTarget = (dir) => {
    const players = gameState.current.players;
    if (players.length === 0) return;
    
    // Find active indices
    const activeIndices = players
      .map((p, i) => (p.active && !p.dead && !p.isSpectator ? i : -1))
      .filter((i) => i !== -1);

    if (activeIndices.length === 0) return;

    let currentPos = activeIndices.indexOf(spectateTargetIndex);
    if (currentPos === -1) currentPos = 0;

    let newPos = currentPos + dir;
    if (newPos >= activeIndices.length) newPos = 0;
    if (newPos < 0) newPos = activeIndices.length - 1;

    setSpectateTargetIndex(activeIndices[newPos]);
  };

  const getLocalInput = () => {
    const sprint = keys.current["shift"] || keys.current["/"];
    const respawn = keys.current[" "];
    const triggerAbility = keys.current["e"];

    let targetAngle = null;
    if (controlMode === "mouse") {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      targetAngle = Math.atan2(mouse.current.y - cy, mouse.current.x - cx);
    } else {
      let dx = 0, dy = 0;
      if (keys.current["w"] || keys.current["arrowup"]) dy -= 1;
      if (keys.current["s"] || keys.current["arrowdown"]) dy += 1;
      if (keys.current["a"] || keys.current["arrowleft"]) dx -= 1;
      if (keys.current["d"] || keys.current["arrowright"]) dx += 1;
      if (dx !== 0 || dy !== 0) targetAngle = Math.atan2(dy, dx);
    }
    return { targetAngle, sprint, respawn, triggerAbility };
  };

  const handleOwnerLogin = (e) => {
    e.preventDefault();
    if (ownerPasswordInput === OWNER_PASSWORD) {
      setShowOwnerLogin(false);
      setShowOwnerPanel(true);
      setOwnerPasswordInput("");
      setCheatMsg("Access Granted");
    } else {
      setCheatMsg("Access Denied");
    }
    setTimeout(() => setCheatMsg(""), 2000);
  };
  const toggleGodMode = () => {
    cheats.current.godMode = !cheats.current.godMode;
    setCheatMsg(cheats.current.godMode ? "GOD MODE: ON" : "GOD MODE: OFF");
  };
  const toggleSpeedHack = () => {
    cheats.current.speedHack = !cheats.current.speedHack;
    setCheatMsg(cheats.current.speedHack ? "SPEED: ON" : "SPEED: OFF");
  };
  const cheatSetSize = (s) => {
    if (gameState.current.players[myPlayerIndex]) {
      gameState.current.players[myPlayerIndex].scale = s;
      gameState.current.players[myPlayerIndex].length = s * 10;
      setCheatMsg("Size: " + s);
    }
  };
  const cheatKillBots = () => {
    gameState.current.enemies.forEach((e) => {
      if (e.alive) {
        e.alive = false;
        killEnemy(e, null);
      }
    });
    setCheatMsg("Bots Cleared");
  };

  const compressState = (state) => ({
    mode: state.mode,
    shakeIntensity: Math.round(state.shakeIntensity),
    food: state.food.map((f) => ({
      x: Math.round(f.x),
      y: Math.round(f.y),
      l: f.level,
      g: f.isGolden ? 1 : 0,
    })),
    mines: state.mines.map((m) => ({
      x: Math.round(m.x),
      y: Math.round(m.y),
      state: m.state,
    })),
    explosions: state.explosions.map((e) => ({
      x: Math.round(e.x),
      y: Math.round(e.y),
      radius: Math.round(e.radius),
      alpha: Number(e.alpha.toFixed(2)),
    })),
    syrupZones: state.syrupZones.map((s) => ({
      x: Math.round(s.x),
      y: Math.round(s.y),
      radius: s.radius,
      oid: s.ownerId,
    })),
    players: state.players.map((p) => ({
      id: p.id,
      active: p.active,
      isSpectator: p.isSpectator || false,
      dead: p.dead,
      x: Math.round(p.x),
      y: Math.round(p.y),
      angle: Number(p.angle.toFixed(2)),
      scale: Number(p.scale.toFixed(2)),
      length: Math.round(p.length),
      country: p.country,
      colorBody: p.colorBody,
      kills: p.kills,
      deaths: p.deaths,
      frozenUntil: p.frozenUntil || 0,
      abilityActive: p.abilityActive || false,
      maplePhase: p.maplePhase,
    })),
    enemies: state.enemies.map((e) => ({
      alive: e.alive,
      color: e.color,
      width: Math.round(e.width),
      x: Math.round(e.x),
      y: Math.round(e.y),
      angle: Number(e.angle.toFixed(2)),
      frozenUntil: e.frozenUntil || 0,
    })),
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const handleResize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      ctx.scale(dpr, dpr);
    };
    window.addEventListener("resize", handleResize);
    handleResize();

    let animationId;
    const loop = (timestamp) => {
      if (menuState !== "playing") {
        const dpr = window.devicePixelRatio || 1;
        ctx.fillStyle = "#000814";
        ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
        ctx.strokeStyle = "rgba(0, 47, 108, 0.2)";
        ctx.lineWidth = 1;
        const w = canvas.width / dpr,
          h = canvas.height / dpr;
        for (let i = 0; i < w; i += 50) {
          ctx.beginPath();
          ctx.moveTo(i, 0);
          ctx.lineTo(i, h);
          ctx.stroke();
        }
        for (let j = 0; j < h; j += 50) {
          ctx.beginPath();
          ctx.moveTo(0, j);
          ctx.lineTo(w, j);
          ctx.stroke();
        }
      } else {
        const state = gameState.current;
        if (
          !isSpectating && 
          state.players[myPlayerIndex] &&
          !state.players[myPlayerIndex].dead &&
          timestamp % 1000 < 16
        ) {
          updateStats({
            scale: state.players[myPlayerIndex].scale,
            length: state.players[myPlayerIndex].length,
          });
        }
        
        // --- GAME LOOP LOGIC ---
        // CRITICAL: If spectating, force client interpolation
        if (isSpectating) {
            updateMultiplayerClientInterpolation();
        } else if (state.mode === "single") {
            updateSinglePlayer(); 
        } else if (state.mode === "multi") {
            if (isHost) {
                updateMultiplayerHost(); 
            } else {
                updateMultiplayerClientInterpolation();
                const input = getLocalInput();
                const inputJson = JSON.stringify(input);
                if (inputJson !== lastInputSent.current || timestamp % 100 === 0) {
                    if (hostConn.current && hostConn.current.open) {
                        hostConn.current.send({
                            type: "INPUT",
                            index: myPlayerIndex,
                            keys: input,
                        });
                        lastInputSent.current = inputJson;
                    }
                }
            }
        }
        
        // --- BROADCAST LOGIC (Single & Multi Host) ---
        if (isHost && timestamp - lastSentTime.current > BROADCAST_RATE) {
            const payload = { type: "STATE", state: compressState(state) };
            connections.current.forEach((c) => {
              if (c.open) c.send(payload);
            });
            lastSentTime.current = timestamp;
        }

        const renderIndex = isSpectating ? spectateTargetIndex : myPlayerIndex;
        renderGame(ctx, canvas, renderIndex);
      }
      animationId = requestAnimationFrame(loop);
    };
    animationId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", handleResize);
    };
  }, [menuState, isHost, myPlayerIndex, controlMode, isSpectating, spectateTargetIndex]);

  function getRandomCountry() {
    return ALL_SKINS[Math.floor(Math.random() * ALL_SKINS.length)];
  }

  // --- SINGLEPLAYER ---
  const initSinglePlayer = () => {
    if (peerRef.current) { cleanupPresence(); peerRef.current.destroy(); }
    setIsSpectating(false);
    updateStats({ game: true });
    
    // Create Peer to allow Spectators
    const peer = new Peer();
    peerRef.current = peer;
    connections.current = [];
    
    peer.on('open', (id) => {
        setMyId(id);
        startHeartbeat(id, 'single');
    });
    
    peer.on('connection', (conn) => {
        conn.on('data', (d) => {
            if(d.type === 'BECOME_SPECTATOR') {
                 connections.current.push(conn);
                 conn.send({ type: "WELCOME", index: -1, count: 1 }); 
            }
        });
        conn.on('close', () => {
             connections.current = connections.current.filter(c => c !== conn);
        });
    });

    gameState.current.mode = "single";
    gameState.current.players = [
      {
        id: 0,
        active: true,
        x: 0,
        y: 0,
        angle: -Math.PI / 2,
        body: [],
        length: 140,
        dead: false,
        country: selectedSkin,
        colorBody: SKIN_BODY_COLORS[selectedSkin],
        scale: 18,
        kills: 0,
        deaths: 0,
        frozenUntil: 0,
        abilityActive: false,
        lastAbilityTime: 0,
        maplePhase: null,
      },
    ];
    resetWorld(true);
    setMenuState("playing");
    setMyPlayerIndex(0);
    setIsHost(true);
  };

  const initHost = (customId = null) => {
    if (peerRef.current) { cleanupPresence(); peerRef.current.destroy(); }
    setIsSpectating(false);
    // @ts-ignore
    const peer = customId ? new Peer(customId) : new Peer();
    peerRef.current = peer;
    connections.current = [];

    peer.on("error", (err) => {
      if (customId && err.type === "unavailable-id") {
        peer.destroy();
        alert("Host Error: " + err.type);
        return;
      }
      alert("Host Error: " + err.type);
    });

    peer.on("open", (id) => {
      setMyId(id);
      setIsHost(true);
      setMenuState("multi_lobby");
      setLobbyCount(1);
      setMyPlayerIndex(0);
      startHeartbeat(id, 'multi');
    });

    peer.on("connection", (conn) => {
      if (connections.current.length >= 20) {
        conn.on("open", () => conn.send({ type: "FULL" }));
        setTimeout(() => conn.close(), 500);
        return;
      }
      connections.current.push(conn);
      const newCount = connections.current.length + 1;
      setLobbyCount(newCount);
      
      conn.on("open", () =>
        conn.send({
          type: "WELCOME",
          index: connections.current.length,
          count: newCount,
        })
      );
      conn.on("data", (data) => {
        if (data.type === "INPUT") remoteInputs.current[data.index] = data.keys;
        if (data.type === "BECOME_SPECTATOR") {
           const pIdx = data.index;
           if (gameState.current.players[pIdx]) {
               gameState.current.players[pIdx].isSpectator = true;
               gameState.current.players[pIdx].active = false;
               gameState.current.players[pIdx].dead = true;
               gameState.current.players[pIdx].x = -99999;
           }
        }
      });
      conn.on("close", () => {
        connections.current = connections.current.filter((c) => c !== conn);
        setLobbyCount(connections.current.length + 1);
      });
    });
  };

  const initJoin = (idToJoin) => {
    if (!idToJoin) return;
    setIsConnecting(true);
    setIsSpectating(false);
    if (peerRef.current) { cleanupPresence(); peerRef.current.destroy(); }
    // @ts-ignore
    const peer = new Peer();
    peerRef.current = peer;
    peer.on("open", () => {
      const conn = peer.connect(idToJoin);
      hostConn.current = conn;
      setIsHost(false);
      conn.on("open", () => {
        setIsConnecting(false);
        setMenuState("multi_lobby");
      });
      conn.on("data", (data) => {
        if (data.type === "WELCOME") {
          setMyPlayerIndex(data.index);
          setLobbyCount(data.count);
        }
        if (data.type === "LOBBY_UPDATE") setLobbyCount(data.count);
        if (data.type === "START") startGameMulti(false, data.playerCount);
        if (data.type === "STATE") {
          serverState.current = data.state;
          if (!gameState.current.players.length)
            gameState.current = JSON.parse(JSON.stringify(data.state));
        }
        if (data.type === "FULL") {
          alert("Room Full!");
          setIsConnecting(false);
        }
      });
      conn.on("close", () => {
        alert("Host Disconnected");
        setIsConnecting(false);
        setMenuState("start");
      });
    });
    peer.on("error", (err) => {
      alert("Connection Error: " + err.type);
      setIsConnecting(false);
    });
  };

  const initSpectate = (idToJoin) => {
      if (!idToJoin) return;
      setIsConnecting(true);
      if (peerRef.current) { cleanupPresence(); peerRef.current.destroy(); }
      // @ts-ignore
      const peer = new Peer();
      peerRef.current = peer;

      // Clean reset of game state
      gameState.current = {
        mode: "spectating", 
        players: [],
        enemies: [],
        food: [],
        mines: [],
        explosions: [],
        syrupZones: [],
        shakeIntensity: 0,
        gameOver: false,
      };

      peer.on("open", () => {
          const conn = peer.connect(idToJoin);
          hostConn.current = conn;
          setIsHost(false);

          conn.on("open", () => {
              setIsConnecting(false);
          });

          conn.on("data", (data) => {
              if (data.type === "WELCOME") {
                  conn.send({ type: "BECOME_SPECTATOR", index: data.index });
                  setMyPlayerIndex(data.index);
                  setIsSpectating(true);
                  setSpectateTargetIndex(0);
                  setShowSpectateBrowser(false);
                  setMenuState("playing"); 
              }
              if (data.type === "START") {
                  startGameMulti(false, data.playerCount);
              }
              if (data.type === "STATE") {
                  serverState.current = data.state;
                  if (!gameState.current.players.length) {
                       gameState.current = JSON.parse(JSON.stringify(data.state));
                  }
              }
          });
          conn.on("close", () => {
              alert("Stream Ended");
              setIsConnecting(false);
              setMenuState("start");
          });
      });
      peer.on("error", (err) => {
        alert("Connection Error: " + err.type);
        setIsConnecting(false);
      });
  };

  const handleQuickPlay = (i) => initHost(`bosnia_snake_v1_room_${i}`);

  const handleHostStart = () => {
    const total = connections.current.length + 1;
    startGameMulti(true, total);
    connections.current.forEach((c) => {
      if (c.open) c.send({ type: "START", playerCount: total });
    });
  };

  const startGameMulti = (isHostLocal, count) => {
    updateStats({ game: true });
    gameState.current.mode = "multi";
    gameState.current.players = [];
    const configs = [
      { country: selectedSkin, cBody: SKIN_BODY_COLORS[selectedSkin], x: 0, y: -200 },
      { country: getRandomCountry(), cBody: "#FFFFFF", x: -200, y: 200 },
      { country: getRandomCountry(), cBody: "#FFFFFF", x: 200, y: 200 },
    ];
    for (let k = 3; k < count + 5; k++)
      configs.push({
        country: getRandomCountry(),
        cBody: "#FFF",
        x: randPosCell(),
        y: randPosCell(),
      });

    for (let i = 0; i < count + 5; i++) {
      const cfg = configs[i] || { country: getRandomCountry(), cBody: "#FFF", x: 0, y: 0 };
      gameState.current.players.push({
        id: i,
        active: true,
        isSpectator: false, 
        x: cfg.x,
        y: cfg.y,
        angle: -Math.PI / 2,
        body: [],
        length: 140,
        dead: false,
        country: cfg.country,
        colorBody: cfg.cBody || "#fff",
        scale: 18,
        kills: 0,
        deaths: 0,
        frozenUntil: 0,
        abilityActive: false,
        lastAbilityTime: 0,
        maplePhase: null,
      });
    }
    if (isHostLocal) resetWorld(false);
    setMenuState("playing");
  };

  const resetWorld = (spawnBots) => {
    const state = gameState.current;
    state.food = [];
    state.mines = [];
    state.explosions = [];
    state.syrupZones = [];
    state.shakeIntensity = 0;
    state.gameOver = false;

    for (let i = 0; i < 400; i++) {
      let level = 1;
      while (level < 100 && Math.random() < 0.5) level++;
      state.food.push({ x: randPosCell(), y: randPosCell(), level: level });
    }

    for (let i = 0; i < 80; i++)
      state.mines.push({
        x: randPosCell(),
        y: randPosCell(),
        state: "idle",
        timer: 3.0,
        lastTick: Date.now(),
      });

    state.players.forEach((p) => {
      p.x = randPosCell();
      p.y = randPosCell();
      p.body = [];
      p.length = 140;
      p.scale = 18;
      p.dead = false;
      p.frozenUntil = 0;
      p.abilityActive = false;
      p.lastAbilityTime = 0;
      p.maplePhase = null;
      p.barrageActive = false;
      p.barrageStartTime = 0;
      p.nextExplosionTime = 0;
      p.sovietBoost = false;
    });

    if (spawnBots) {
      state.enemies = [];
      for (let i = 0; i < MAX_ENEMIES; i++) spawnOneEnemy();
    } else state.enemies = [];
  };

  function spawnOneEnemy() {
    gameState.current.enemies.push({
      x: randPosCell(),
      y: randPosCell(),
      angle: Math.random() * Math.PI * 2,
      body: [],
      length: 140 + Math.random() * 200,
      width: 12,
      speed: (2.5 + Math.random()) * 1.1,
      boostSpeed: 7.5 * 1.1,
      turnSpeed: 0.08,
      alive: true,
      color: ["#8A2BE2", "#DC143C", "#228B22", "#FF4500", "#1E90FF"][
        Math.floor(Math.random() * 5)
      ],
      frozenUntil: 0,
      inZoneSince: null,
      outZoneSince: null,
      isEnraged: false,
    });
  }

  function updateSinglePlayer() {
    const state = gameState.current;
    const p = state.players[0];
    if (p.dead) {
      if (keys.current["r"]) resetWorld(true);
      return;
    }
    state.enemies = state.enemies.filter((e) => e.alive);
    if (state.enemies.length < MAX_ENEMIES && Math.random() < 0.02)
      spawnOneEnemy();

    const inp = getLocalInput();
    handlePhysics(p, inp);
    updateAI();
    updateEnvironment([p]);
  }

  function updateMultiplayerHost() {
    const state = gameState.current;
    state.players.forEach((p, i) => {
      if (!p.active || p.isSpectator) return;
      let inp = i === 0 ? getLocalInput() : remoteInputs.current[i] || {};
      if (p.dead) {
        if (i === 0 && getLocalInput().respawn) respawnPlayer(p);
        else if (inp.respawn) respawnPlayer(p);
      } else {
        handlePhysics(p, inp);
      }
    });

    for (let i = 0; i < state.players.length; i++) {
      for (let j = i + 1; j < state.players.length; j++) {
        const pA = state.players[i],
          pB = state.players[j];
        if (!pA.active || !pB.active || pA.dead || pB.dead || pA.isSpectator || pB.isSpectator) continue;
        if (coll(pA, pB, pA.scale + pB.scale)) {
          killPlayer(pA, null);
          killPlayer(pB, null);
        } else if (checkBodyCollision(pA, pB)) killPlayer(pA, pB);
        else if (checkBodyCollision(pB, pA)) killPlayer(pB, pA);
      }
    }
    updateAI();
    updateEnvironment(state.players.filter((p) => p.active && !p.isSpectator));
  }

  function updateMultiplayerClientInterpolation() {
    if (!serverState.current) return;
    const cur = gameState.current;
    const tar = serverState.current;
    cur.food = tar.food.map((f) => ({ x: f.x, y: f.y, level: f.l, isGolden: f.g === 1 }));
    cur.mines = tar.mines;
    cur.explosions = tar.explosions;
    cur.syrupZones = (tar.syrupZones || []).map((s) => ({
      x: s.x,
      y: s.y,
      radius: s.radius,
      ownerId: s.oid,
    }));
    cur.shakeIntensity = tar.shakeIntensity;

    if (cur.enemies.length !== tar.enemies.length)
      cur.enemies = tar.enemies.map((e) => ({ ...e, body: [] }));
    cur.enemies.forEach((e, i) => {
      const tE = tar.enemies[i];
      if (!tE) return;
      e.x = lerp(e.x, tE.x, INTERPOLATION_SPEED);
      e.y = lerp(e.y, tE.y, INTERPOLATION_SPEED);
      e.alive = tE.alive;
      e.color = tE.color;
      e.width = tE.width;
      e.frozenUntil = tE.frozenUntil;
      if (e.alive) {
        e.body.unshift({ x: e.x, y: e.y });
        while (e.body.length > 140) e.body.pop();
      }
    });

    cur.players.forEach((p, i) => {
      const tP = tar.players[i];
      if (!tP) return;
      p.isSpectator = tP.isSpectator;
      p.active = tP.active;
      
      p.x = lerp(p.x, tP.x, INTERPOLATION_SPEED);
      p.y = lerp(p.y, tP.y, INTERPOLATION_SPEED);
      p.angle = lerpAngle(p.angle, tP.angle, INTERPOLATION_SPEED);

      if (i === myPlayerIndex && tP.kills > p.kills)
        updateStats({ kill: true });

      p.dead = tP.dead;
      p.scale = tP.scale;
      p.length = tP.length;
      p.kills = tP.kills;
      p.deaths = tP.deaths;
      p.frozenUntil = tP.frozenUntil;
      p.abilityActive = tP.abilityActive;
      p.maplePhase = tP.maplePhase;

      if (!p.dead && !p.isSpectator) {
        p.body.unshift({ x: p.x, y: p.y });
        while (p.body.length > p.length) p.body.pop();
      } else {
        if (i === myPlayerIndex && !gameState.current.players[i].dead && tP.dead && !p.isSpectator) {
          updateStats({ death: true, scale: p.scale, length: p.length });
          submitScoreToLeaderboard(p.scale);
        }
        p.body = [];
      }
      p.country = tP.country;
      p.colorBody = tP.colorBody;
    });
  }

  function handlePhysics(p, inp) {
    if (p.frozenUntil > Date.now()) return;
    const now = Date.now();

    if (p.country === "soviet") {
      if (inp.sprint && !p.barrageActive && (!p.lastAbilityTime || now - p.lastAbilityTime > 60000)) {
        p.barrageActive = true;
        p.barrageEndTime = now + 2000;
        p.nextExplosionTime = now;
        p.abilityActive = true;
      }
      if (p.barrageActive) {
        if (now >= p.barrageEndTime) {
          p.barrageActive = false;
          p.abilityActive = false;
          p.sovietBoost = false;
          p.lastAbilityTime = now;
        } else {
          p.sovietBoost = true;
          if (now >= p.nextExplosionTime) {
            createExplosion(p.x, p.y, 3 * CELL);
            gameState.current.shakeIntensity = Math.min(60, gameState.current.shakeIntensity + 10);
            p.nextExplosionTime = now + 200;
            if (dist(p, gameState.current.players[isSpectating ? spectateTargetIndex : myPlayerIndex] || {x:0, y:0}) < 900) {
              playSound("soviet_boom");
            }
            const killRad = 3 * CELL;
            gameState.current.players.forEach((v) => {
              if (v.id !== p.id && !v.dead && !v.isSpectator && dist(v, p) < killRad)
                killPlayer(v, p);
            });
            gameState.current.enemies.forEach((e) => {
              if (e.alive && dist(e, p) < killRad) killEnemy(e, p);
            });
          }
        }
      }
    }

    if (p.country === "golden_maple") {
      if (inp.triggerAbility && (!p.lastAbilityTime || now - p.lastAbilityTime > 60000) && !p.maplePhase) {
        p.maplePhase = "harvest";
        p.phaseEndTime = now + 2500;
        p.lastAbilityTime = now;
        if (dist(p, gameState.current.players[isSpectating ? spectateTargetIndex : myPlayerIndex] || {x:0,y:0}) < 900) {
          playSound("angelic");
        }
      }
      if (p.maplePhase === "harvest") {
        if (now > p.phaseEndTime) {
          p.maplePhase = "syrup";
          p.phaseEndTime = now + 5000;
          gameState.current.syrupZones.push({
            x: p.x,
            y: p.y,
            radius: 6 * CELL,
            expiresAt: now + 5000,
            ownerId: p.id,
          });
        }
      } else if (p.maplePhase === "syrup") {
        if (now > p.phaseEndTime) {
          p.maplePhase = null;
        }
      }
    }

    let speedMult = 1.0;
    let turnMult = 1.0; 
    gameState.current.syrupZones.forEach((zone) => {
      if (dist(p, zone) < zone.radius && zone.ownerId !== p.id) {
        speedMult = 0.4; 
        turnMult = 0.33;
      }
    });

    if (inp.targetAngle !== null) {
      let d = normalizeAngle(inp.targetAngle - p.angle);
      const effectiveTurnSpeed = TURN_SPEED * turnMult;
      if (Math.abs(d) < effectiveTurnSpeed) p.angle = inp.targetAngle;
      else p.angle += d > 0 ? effectiveTurnSpeed : -effectiveTurnSpeed;
      p.angle = normalizeAngle(p.angle);
    }

    let s = BASE_SPEED * speedMult;
    if (p.id === myPlayerIndex && cheats.current.speedHack) s = BASE_SPEED * 3;

    const canSprint = inp.sprint && p.length > MIN_LENGTH && (!p.abilityActive || p.country === "soviet");
    if (canSprint) {
      s *= 1.8;
      if (p.sovietBoost) s *= 2.0;
      p.length -= SPRINT_COST;
    }

    p.x += Math.cos(p.angle) * s;
    p.y += Math.sin(p.angle) * s;
    if (Math.abs(p.x) > WORLD_SIZE / 2 || Math.abs(p.y) > WORLD_SIZE / 2)
      killPlayer(p, null);
    p.body.unshift({ x: p.x, y: p.y });
    while (p.body.length > p.length) p.body.pop();
  }

  function updateAI() {
    const state = gameState.current;
    const viewDist = 500;
    const now = Date.now();
    const TRIGGER_DIST = 5 * CELL;
    const RESET_DIST = 8 * CELL;
    const TRIGGER_TIME = 3000;
    const RESET_TIME = 2000;

    state.enemies.forEach((enemy) => {
      if (!enemy.alive) return;
      if (enemy.frozenUntil && now < enemy.frozenUntil) return;
      if (!enemy.baseScale) enemy.baseScale = 12;
      const currentCalculatedWidth = 12 + Math.min(33, (enemy.length - 140) / 10);
      if (currentCalculatedWidth > enemy.baseScale) enemy.baseScale = currentCalculatedWidth;
      enemy.width = enemy.baseScale;

      let aiSpeedMult = 1.0;
      let aiTurnMult = 1.0;
      state.syrupZones.forEach((zone) => {
        if (dist(enemy, zone) < zone.radius) {
          aiSpeedMult = 0.4;
          aiTurnMult = 0.33; 
        }
      });

      let target = null;
      let minDist = Infinity;
      state.players.forEach((p) => {
        if (!p.dead && p.active && !p.isSpectator) {
          const d = dist(enemy, p);
          if (d < minDist) {
            minDist = d;
            target = p;
          }
        }
      });

      if (target) {
        if (minDist < TRIGGER_DIST) {
          if (!enemy.inZoneSince) enemy.inZoneSince = now;
          enemy.outZoneSince = null;
          if (now - enemy.inZoneSince > TRIGGER_TIME) enemy.isEnraged = true;
        } else if (minDist > RESET_DIST) {
          if (!enemy.outZoneSince) enemy.outZoneSince = now;
          enemy.inZoneSince = null;
          if (now - enemy.outZoneSince > RESET_TIME) enemy.isEnraged = false;
        }
      } else {
        enemy.isEnraged = false;
        enemy.inZoneSince = null;
      }

      let forceSprint = false;
      let targetAngle = enemy.angle;
      let criticalThreat = null;
      let minCritDist = 160;

      state.players.forEach((p) => {
        if (!p.dead && p.active && !p.isSpectator) {
          for (let i = 0; i < p.body.length; i += 2) {
            const d = dist(enemy, p.body[i]);
            if (d < minCritDist && d < enemy.width + p.scale + 40) {
              criticalThreat = p.body[i];
              minCritDist = d;
            }
          }
        }
      });
      state.enemies.forEach((e2) => {
        if (e2 !== enemy && e2.alive) {
          for (let i = 0; i < e2.body.length; i += 4) {
            const d = dist(enemy, e2.body[i]);
            if (d < minCritDist && d < enemy.width + e2.width + 40) {
              criticalThreat = e2.body[i];
              minCritDist = d;
            }
          }
        }
      });

      if (criticalThreat) {
        const angleFromThreat = Math.atan2(enemy.y - criticalThreat.y, enemy.x - criticalThreat.x);
        targetAngle = angleFromThreat;
        forceSprint = true;
      } else {
        let panicMine = null;
        let minMineDist = Infinity;
        for (let m of state.mines) {
          const d = dist(enemy, m);
          const safeZone = m.state === "triggered" ? 500 : 350;
          if (d < safeZone && d < minMineDist) {
            minMineDist = d;
            panicMine = m;
          }
        }

        const feelers = [
          { angle: enemy.angle - 0.7, dist: viewDist, type: "left" },
          { angle: enemy.angle - 0.35, dist: viewDist + 100, type: "midLeft" },
          { angle: enemy.angle, dist: viewDist + 150, type: "center" },
          { angle: enemy.angle + 0.35, dist: viewDist + 100, type: "midRight" },
          { angle: enemy.angle + 0.7, dist: viewDist, type: "right" },
        ];

        let dangerLeft = 0;
        let dangerRight = 0;
        let blockedCenter = false;

        const checkPointDanger = (px, py) => {
          const limit = WORLD_SIZE / 2 - 100;
          if (px < -limit || px > limit || py < -limit || py > limit) return 300;
          for (let m of state.mines) {
            if (dist({ x: px, y: py }, m) < 220) return 2000;
          }
          return 0;
        };

        feelers.forEach((f) => {
          const steps = 5;
          for (let s = 1; s <= steps; s++) {
            const danger = checkPointDanger(
              enemy.x + Math.cos(f.angle) * (f.dist / steps) * s,
              enemy.y + Math.sin(f.angle) * (f.dist / steps) * s
            );
            if (danger > 0) {
              if (f.type.includes("left") || f.type.includes("Left")) dangerLeft += danger / s;
              if (f.type.includes("right") || f.type.includes("Right")) dangerRight += danger / s;
              if (f.type === "center") blockedCenter = true;
            }
          }
        });

        if (dangerLeft > 0 || dangerRight > 0 || blockedCenter) {
          if (dangerLeft > dangerRight) targetAngle += 2.5;
          else if (dangerRight > dangerLeft) targetAngle -= 2.5;
          else targetAngle += 3.0;
        } else if (panicMine) {
          targetAngle = Math.atan2(enemy.y - panicMine.y, enemy.x - panicMine.x);
          forceSprint = true;
        } else if (enemy.isEnraged && target) {
          const playerSpeed = target.length < target.length - 1 ? BASE_SPEED * 1.8 : BASE_SPEED;
          const lookAhead = Math.min(60, minDist / 5);
          const predX = target.x + Math.cos(target.angle) * playerSpeed * lookAhead;
          const predY = target.y + Math.sin(target.angle) * playerSpeed * lookAhead;
          targetAngle = Math.atan2(predY - enemy.y, predX - enemy.x);
          if (Math.abs(normalizeAngle(targetAngle - enemy.angle)) < 0.3 && minDist > 150)
            forceSprint = true;
        } else {
          let closestFood = null;
          let minFoodDist = Infinity;
          state.food.forEach((f) => {
            const d = dist(enemy, f);
            if (d < minFoodDist && d < 600) {
              minFoodDist = d;
              closestFood = f;
            }
          });
          if (closestFood)
            targetAngle = Math.atan2(closestFood.y - enemy.y, closestFood.x - enemy.x);
        }
      }

      let diff = normalizeAngle(targetAngle - enemy.angle);
      const turn = (forceSprint ? enemy.turnSpeed * 1.5 : enemy.turnSpeed) * aiTurnMult;

      if (Math.abs(diff) < turn) enemy.angle = targetAngle;
      else if (diff > 0) enemy.angle += turn;
      else enemy.angle -= turn;
      enemy.angle = normalizeAngle(enemy.angle);

      const spd = (forceSprint && enemy.length > 145 ? enemy.boostSpeed : enemy.speed) * aiSpeedMult;

      if (forceSprint && enemy.length > 145) enemy.length -= 0.3; 

      enemy.x += Math.cos(enemy.angle) * spd;
      enemy.y += Math.sin(enemy.angle) * spd;
      enemy.body.unshift({ x: enemy.x, y: enemy.y });
      while (enemy.body.length > enemy.length) enemy.body.pop();

      for (let i = state.food.length - 1; i >= 0; i--) {
        if (coll(enemy, state.food[i], enemy.width + 10)) {
          state.food.splice(i, 1);
          enemy.length += 12;
        }
      }

      state.players.forEach((p) => {
        if (!p.dead && p.active && !p.isSpectator) {
          if (coll(p, enemy, p.scale + enemy.width)) killPlayer(p, null);
          if (checkBodyCollision(p, enemy)) killPlayer(p, null);
          for (let j = 0; j < p.body.length; j += 2)
            if (coll(enemy, p.body[j], enemy.width + p.scale))
              killEnemy(enemy, p);
        }
      });
    });
  }

  function updateEnvironment(active) {
    const s = gameState.current;
    const now = Date.now();
    for (let i = s.syrupZones.length - 1; i >= 0; i--) {
      if (now > s.syrupZones[i].expiresAt) s.syrupZones.splice(i, 1);
    }
    for (let i = s.explosions.length - 1; i >= 0; i--) {
      s.explosions[i].radius += 15;
      s.explosions[i].alpha -= 0.05;
      if (s.explosions[i].alpha <= 0) s.explosions.splice(i, 1);
    }
    if (s.food.length < 400) {
      for (let k = 0; k < 10; k++) {
        let level = 1;
        while (level < 100 && Math.random() < 0.5) level++;
        s.food.push({ x: randPosCell(), y: randPosCell(), level: level });
      }
    }
    active.forEach((p) => {
      if (p.country === "golden_maple" && p.maplePhase === "harvest") {
        s.food.forEach((f) => {
          if (dist(p, f) < 5 * CELL) f.isGolden = true;
        });
      }
    });

    s.food.forEach((f, i) => {
      const foodLevel = f.level || 1;
      const rad = FOOD_RADIUS_BASE + foodLevel * 1.5;

      active.forEach((p) => {
        if (!p.dead && !p.isSpectator && coll(p, f, p.scale + rad)) {
          if (p.id === myPlayerIndex) {
            playSound("eat");
          }
          s.food.splice(i, 1);
          const multiplier = f.isGolden ? 3 : 1;
          p.length += LENGTH_GAIN * multiplier;
          p.scale = Math.min(600, p.scale + foodLevel * SIZE_GAIN_PER_LEVEL * multiplier);
        }
      });
    });

    for (let i = s.mines.length - 1; i >= 0; i--) {
      let m = s.mines[i];
      if (m.state === "idle") {
        let triggered = false;
        active.forEach((p) => {
          if (!p.dead && !p.isSpectator && dist(p, m) < 200) triggered = true;
        });
        if (triggered) {
          m.state = "triggered";
          m.lastTick = now;
        }
      } else if (m.state === "triggered") {
        if (now - m.lastTick > m.timer * 1000) {
          createExplosion(m.x, m.y);
          active.forEach((p) => {
            if (!p.dead && !p.isSpectator && dist(p, m) < 300) killPlayer(p, null);
          });
          s.mines.splice(i, 1);
        }
      }
    }
  }

  function createExplosion(x, y, radius = 10) {
    gameState.current.explosions.push({ x, y, radius: radius, alpha: 1.0 });
    gameState.current.shakeIntensity = Math.min(
      100,
      gameState.current.shakeIntensity + 30
    );
  }

  function killPlayer(victim, killer) {
    if (victim.dead || victim.isSpectator) return;
    if (victim.id === myPlayerIndex && cheats.current.godMode) return;
    victim.dead = true;
    victim.deaths++;
    victim.abilityActive = false;
    victim.maplePhase = null;

    if (victim.id === myPlayerIndex) {
      updateStats({ death: true, scale: victim.scale, length: victim.length });
      submitScoreToLeaderboard(victim.scale);
    }

    if (killer) {
      killer.kills++;
      if (killer.id === myPlayerIndex) {
        updateStats({ kill: true });
      }
    }

    createExplosion(victim.x, victim.y);

    const totalValue = victim.length * 0.4;
    const foodCount = Math.max(3, Math.floor(totalValue / LENGTH_GAIN));

    for (let k = 0; k < foodCount; k++) {
      const index = Math.floor(Math.random() * victim.body.length);
      if (victim.body[index])
        gameState.current.food.push({
          x: victim.body[index].x,
          y: victim.body[index].y,
          level: Math.floor(Math.random() * 3) + 1,
        });
    }
  }

  function killEnemy(e, killer) {
    if (!e.alive) return;
    e.alive = false;
    if (killer) {
      killer.kills++;
      if (killer.id === myPlayerIndex) updateStats({ kill: true });
    }
    createExplosion(e.x, e.y);
    const totalValue = e.length * 0.4;
    const foodCount = Math.max(3, Math.floor(totalValue / LENGTH_GAIN));
    const stepSize = Math.max(1, Math.floor(e.body.length / foodCount));
    for (let i = 0; i < e.body.length; i += stepSize) {
      const point = e.body[i];
      gameState.current.food.push({
        x: point.x + (Math.random() - 0.5) * 20,
        y: point.y + (Math.random() - 0.5) * 20,
        level: Math.floor(Math.random() * 3) + 1,
      });
    }
  }

  function checkBodyCollision(attacker, victim) {
    const aR = attacker.scale || 15;
    const vR = victim.scale || 15;
    for (let i = 5; i < victim.body.length; i += 2) {
      if (coll(attacker, victim.body[i], aR + vR - 5)) return true;
    }
    return false;
  }

  function respawnPlayer(p) {
    p.x = randPosCell();
    p.y = randPosCell();
    p.dead = false;
    p.body = [];
    p.length = 140;
    p.scale = 18;
    p.frozenUntil = 0;
    p.abilityActive = false;
    p.maplePhase = null;
    p.barrageActive = false;
    p.barrageStartTime = 0;
    p.nextExplosionTime = 0;
    p.sovietBoost = false;
  }

  function renderGame(ctx, canvas, targetIdx) {
    const state = gameState.current;
    const dpr = window.devicePixelRatio || 1;
    const target = state.players[targetIdx] || state.players[0];
    const me = target || state.players[0];

    const startScale = 18;
    const zoom = Math.max(
      0.1,
      0.6 * (30 / (30 + (me.scale - startScale) * 0.4))
    );

    let sx = 0, sy = 0;
    if (state.shakeIntensity > 0) {
      sx = (Math.random() - 0.5) * state.shakeIntensity;
      sy = (Math.random() - 0.5) * state.shakeIntensity;
      state.shakeIntensity *= 0.9;
    }

    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    ctx.save();
    ctx.translate(canvas.width / dpr / 2 + sx, canvas.height / dpr / 2 + sy);
    ctx.scale(zoom, zoom);
    ctx.translate(-me.x, -me.y);

    ctx.lineWidth = 12;
    ctx.strokeStyle = "rgba(255,0,0,0.9)";
    ctx.strokeRect(-WORLD_SIZE / 2, -WORLD_SIZE / 2, WORLD_SIZE, WORLD_SIZE);

    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.beginPath();
    const half = WORLD_SIZE / 2;
    for (let x = -half; x <= half; x += CELL) {
      ctx.moveTo(x, -half);
      ctx.lineTo(x, half);
    }
    for (let y = -half; y <= half; y += CELL) {
      ctx.moveTo(-half, y);
      ctx.lineTo(half, y);
    }
    ctx.stroke();

    if (me.country === "ireland" && !me.dead) {
      ctx.save();
      ctx.strokeStyle = "rgba(0, 255, 0, 0.6)";
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 10]);
      state.enemies.forEach((e) => {
        if (e.alive) {
          ctx.beginPath();
          ctx.moveTo(me.x, me.y);
          ctx.lineTo(e.x, e.y);
          ctx.stroke();
        }
      });
      state.players.forEach((p) => {
        if (p.id !== me.id && p.active && !p.dead && !p.isSpectator) {
          ctx.beginPath();
          ctx.moveTo(me.x, me.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }
      });
      ctx.restore();
    }

    state.syrupZones.forEach((z) => {
      ctx.fillStyle = "rgba(184, 134, 11, 0.5)"; 
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#DAA520";
      ctx.lineWidth = 4;
      ctx.stroke();
    });

    state.food.forEach((f) => {
      const level = f.level || 1;
      const size = FOOD_RADIUS_BASE + level * 1.5;
      if (f.isGolden) {
        ctx.fillStyle = "#FFD700";
        ctx.shadowColor = "#FFD700";
        ctx.shadowBlur = 10;
      } else {
        ctx.fillStyle = "orange";
        ctx.shadowBlur = 0;
      }
      ctx.beginPath();
      ctx.arc(f.x, f.y, size, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      if (level > 8) {
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = "white";
        ctx.beginPath();
        ctx.arc(f.x, f.y, size + 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
      }
    });

    state.mines.forEach((m) => {
      if (m.state === "triggered" && Math.floor(Date.now() / 100) % 2 === 0) {
        ctx.fillStyle = "rgba(255,0,0,0.3)";
        ctx.beginPath();
        ctx.arc(m.x, m.y, 200, 0, Math.PI * 2);
        ctx.fill();
      }
      const r = 25;
      const d = r * 2;
      ctx.save();
      ctx.beginPath();
      ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = "#C6363C";
      ctx.fillRect(m.x - r, m.y - r, d, d / 3);
      ctx.fillStyle = "#0C4076";
      ctx.fillRect(m.x - r, m.y - r + d / 3, d, d / 3);
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(m.x - r, m.y - r + (2 * d) / 3, d, d / 3);
      ctx.fillStyle = "white";
      ctx.beginPath();
      ctx.moveTo(m.x - 10, m.y - 10);
      ctx.lineTo(m.x, m.y - 10);
      ctx.lineTo(m.x, m.y + 5);
      ctx.lineTo(m.x - 5, m.y + 12);
      ctx.lineTo(m.x - 10, m.y + 5);
      ctx.fill();
      ctx.fillStyle = "#C6363C";
      ctx.beginPath();
      ctx.moveTo(m.x - 8, m.y - 8);
      ctx.lineTo(m.x - 2, m.y - 8);
      ctx.lineTo(m.x - 2, m.y + 3);
      ctx.lineTo(m.x - 5, m.y + 8);
      ctx.lineTo(m.x - 8, m.y + 3);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = m.state === "triggered" ? "red" : "#333";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
      ctx.stroke();
    });

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    state.players.forEach((pl) => {
      if (!pl.active || pl.dead || pl.isSpectator) return;
      if (pl.frozenUntil && Date.now() < pl.frozenUntil) {
        ctx.shadowBlur = 15;
        ctx.shadowColor = "cyan";
      }
      if (pl.country === "soviet" && pl.abilityActive) {
        ctx.shadowBlur = 30;
        ctx.shadowColor = "#FF0000";
      }
      if (pl.country === "golden_maple" && pl.maplePhase === "harvest") {
        ctx.shadowBlur = 40;
        ctx.shadowColor = "#DAA520";
        ctx.strokeStyle = "rgba(218, 165, 32, 0.4)";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(pl.x, pl.y, 5 * CELL, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.lineWidth = pl.scale * 1.2;
      ctx.strokeStyle =
        pl.frozenUntil && Date.now() < pl.frozenUntil ? "cyan" : pl.colorBody;
      ctx.beginPath();
      if (pl.body.length) {
        ctx.moveTo(pl.body[0].x, pl.body[0].y);
        pl.body.forEach((b) => ctx.lineTo(b.x, b.y));
        ctx.stroke();
      }
      ctx.shadowBlur = 0;

      const r = pl.scale * 0.65;
      ctx.save();
      ctx.translate(pl.x, pl.y);
      ctx.rotate(pl.angle + Math.PI / 2);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.clip();

      if (pl.country === "bosnia") {
        ctx.fillStyle = "#002F6C";
        ctx.fillRect(-r, -r, r * 2, r * 2);
        ctx.fillStyle = "#FECB00";
        ctx.beginPath();
        ctx.moveTo(r * 0.2, -r);
        ctx.lineTo(r * 0.2, r);
        ctx.lineTo(r, -r * 0.5);
        ctx.fill();
        ctx.fillStyle = "white";
        for (let i = 0; i < 5; i++) {
          ctx.beginPath();
          ctx.arc(-r * 0.2, -r * 0.6 + i * r * 0.4, r * 0.1, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (pl.country === "russia") {
        ctx.fillStyle = "white";
        ctx.fillRect(-r, -r, r * 2, (r * 2) / 3);
        ctx.fillStyle = "#0039A6";
        ctx.fillRect(-r, -r + (r * 2) / 3, r * 2, (r * 2) / 3);
        ctx.fillStyle = "#D52B1E";
        ctx.fillRect(-r, -r + (2 * r * 2) / 3, r * 2, (r * 2) / 3);
      } else if (pl.country === "germany") {
        ctx.fillStyle = "black";
        ctx.fillRect(-r, -r, r * 2, (r * 2) / 3);
        ctx.fillStyle = "#DD0000";
        ctx.fillRect(-r, -r + (r * 2) / 3, r * 2, (r * 2) / 3);
        ctx.fillStyle = "#FFCC00";
        ctx.fillRect(-r, -r + (2 * r * 2) / 3, r * 2, (r * 2) / 3);
      } else if (pl.country === "france") {
        ctx.fillStyle = "#0055A4";
        ctx.fillRect(-r, -r, (r * 2) / 3, r * 2);
        ctx.fillStyle = "white";
        ctx.fillRect(-r + (r * 2) / 3, -r, (r * 2) / 3, r * 2);
        ctx.fillStyle = "#EF4135";
        ctx.fillRect(-r + (2 * r * 2) / 3, -r, (r * 2) / 3, r * 2);
      } else if (pl.country === "ireland") {
        ctx.fillStyle = "#169B62";
        ctx.fillRect(-r, -r, (r * 2) / 3, r * 2);
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(-r + (r * 2) / 3, -r, (r * 2) / 3, r * 2);
        ctx.fillStyle = "#FF883E";
        ctx.fillRect(-r + (2 * r * 2) / 3, -r, (r * 2) / 3, r * 2);
      } else if (pl.country === "canada") {
        ctx.fillStyle = "#FF0000";
        ctx.fillRect(-r, -r, (r * 2) / 4, r * 2);
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(-r + (r * 2) / 4, -r, r, r * 2);
        ctx.fillStyle = "#FF0000";
        ctx.fillRect(r / 2, -r, (r * 2) / 4, r * 2);
        ctx.fillStyle = "#FF0000";
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.4);
        ctx.lineTo(r * 0.3, 0);
        ctx.lineTo(0, r * 0.4);
        ctx.lineTo(-r * 0.3, 0);
        ctx.fill();
      } else if (pl.country === "ukraine") {
        ctx.fillStyle = "#0057B8";
        ctx.fillRect(-r, -r, r * 2, r);
        ctx.fillStyle = "#FFD700";
        ctx.fillRect(-r, 0, r * 2, r);
      } else if (pl.country === "soviet") {
        ctx.fillStyle = "#CC0000";
        ctx.fillRect(-r, -r, r * 2, r * 2);
        ctx.fillStyle = "#FFD700";
        ctx.beginPath();
        ctx.arc(-r * 0.4, -r * 0.4, r * 0.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#FFD700";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(-r * 0.4, -r * 0.2, r * 0.2, 0, Math.PI);
        ctx.stroke();
      } else if (pl.country === "golden_maple") {
        ctx.fillStyle = "#DAA520";
        ctx.fillRect(-r, -r, r * 2, r * 2); 
        ctx.fillStyle = "#B22222";
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.5);
        ctx.lineTo(r * 0.3, 0);
        ctx.lineTo(0, r * 0.5);
        ctx.lineTo(-r * 0.3, 0);
        ctx.fill();
      } else {
        ctx.fillStyle = pl.colorBody || "white";
        ctx.fillRect(-r, -r, r * 2, r * 2);
      }
      ctx.restore();
    });

    state.enemies.forEach((e) => {
      if (!e.alive) return;
      ctx.strokeStyle =
        e.frozenUntil && Date.now() < e.frozenUntil ? "cyan" : e.color;
      ctx.lineWidth = e.width * 2;
      ctx.beginPath();
      if (e.body.length) {
        ctx.moveTo(e.body[0].x, e.body[0].y);
        e.body.forEach((b) => ctx.lineTo(b.x, b.y));
        ctx.stroke();
      }
      ctx.fillStyle = e.color;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.width * 1.05, 0, Math.PI * 2);
      ctx.fill();
    });

    state.explosions.forEach((ex) => {
      ctx.fillStyle = `rgba(255,69,0,${ex.alpha})`;
      ctx.beginPath();
      ctx.arc(ex.x, ex.y, ex.radius, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.restore();

    // --- HUD ---
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // SPECTATOR OVERLAY
    if (isSpectating) {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(0, canvas.height/dpr - 80, canvas.width/dpr, 80);
        
        ctx.fillStyle = "white";
        ctx.font = "bold 20px Arial";
        ctx.textAlign = "center";
        ctx.fillText(`SPECTATING: Player ${targetIdx}`, canvas.width/dpr/2, canvas.height/dpr - 45);
        
        ctx.font = "14px Arial";
        ctx.fillStyle = "#ccc";
        ctx.fillText("Use Arrow Keys to Switch Players", canvas.width/dpr/2, canvas.height/dpr - 25);
    }

    if (!me.dead && !isSpectating) {
      const hudW = 220;
      const hudH = 50;
      const hudX = 20;
      const hudY = 20;

      ctx.fillStyle = "rgba(0, 15, 60, 0.7)";
      ctx.strokeStyle = "#0055A4";
      ctx.lineWidth = 2;
      ctx.roundRect(hudX, hudY, hudW, hudH, 10);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "white";
      ctx.font = "bold 22px Arial";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(`Size: ${me.scale.toFixed(1)}`, hudX + 15, hudY + hudH / 2);

      ctx.font = "bold 14px Arial";
      ctx.fillStyle = "#FECB00";
      ctx.textAlign = "right";
      ctx.fillText(`Kills: ${me.kills}`, hudX + hudW - 15, hudY + hudH / 2);
    }

    if (!me.dead && !isSpectating && ["soviet", "golden_maple"].includes(me.country)) {
      const cooldown = 60000;
      const timeSince = Date.now() - (me.lastAbilityTime || 0);
      const isSovietActive = me.barrageActive;
      const isMapleActive = !!me.maplePhase;
      const isActive = isSovietActive || isMapleActive;

      let displayText = "READY";
      let displayColor = "#FFD700"; 
      let progress = 1;

      if (isActive) {
        displayText = "ACTIVE";
        displayColor = "#00FF00"; 
        if (Math.floor(Date.now() / 200) % 2 === 0) displayColor = "#FFFFFF";
      } else if (timeSince < cooldown) {
        const remaining = Math.ceil((cooldown - timeSince) / 1000);
        displayText = remaining + "s";
        displayColor = "#AAAAAA"; 
        progress = timeSince / cooldown;
      }

      const cw = canvas.width / dpr;
      const ch = canvas.height / dpr;
      const radius = 40;
      const cx = cw - 60;
      const cy = ch - 60;

      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fill();

      ctx.beginPath();
      ctx.arc(cx, cy, radius - 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
      ctx.strokeStyle = displayColor;
      ctx.lineWidth = 5;
      ctx.stroke();

      ctx.fillStyle = displayColor;
      ctx.font = "bold 16px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(displayText, cx, cy);

      ctx.fillStyle = "white";
      ctx.font = "12px Arial";
      ctx.fillText("ABILITY", cx, cy + radius + 15);
    }

    if (me.dead && !isSpectating) {
      ctx.fillStyle = "white";
      ctx.font = "bold 40px Arial";
      ctx.textAlign = "center";
      ctx.fillText(
        "YOU DIED",
        canvas.width / dpr / 2,
        canvas.height / dpr / 2 - 50
      );
      ctx.font = "20px Arial";
      ctx.fillText(
        state.mode === "single"
          ? "Press R to Restart"
          : "Press SPACE to Respawn",
        canvas.width / dpr / 2,
        canvas.height / dpr / 2
      );
    }
  }

  const styles = {
    wrapper: {
      position: "fixed",
      top: 0,
      left: 0,
      width: "100vw",
      height: "100vh",
      background: "#080b12",
      color: "white",
      fontFamily: "'Segoe UI', sans-serif",
      overflow: "hidden",
    },
    clusterContainer: {
      position: "absolute",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      display: "flex",
      alignItems: "stretch",
      gap: "15px",
      height: "700px",
      zIndex: 10,
    },
    statsPanel: {
      width: "220px",
      background: "rgba(0, 35, 149, 0.6)",
      backdropFilter: "blur(15px)",
      border: "1px solid rgba(254, 203, 0, 0.3)",
      borderRadius: "10px",
      padding: "25px",
      display: "flex",
      flexDirection: "column",
      boxShadow: "0 0 20px rgba(0,0,0,0.5)",
    },
    mainMenu: {
      width: "500px",
      background: "rgba(0, 15, 60, 0.85)",
      backdropFilter: "blur(20px)",
      border: "2px solid #FECB00",
      borderRadius: "10px",
      padding: "40px",
      display: "flex",
      flexDirection: "column",
      position: "relative",
      boxShadow: "0 0 40px rgba(0, 47, 108, 0.5)",
      overflowY: "auto",
      maxHeight: "100%",
      WebkitOverflowScrolling: "touch",
    },
    leaderboardPanel: {
      width: "250px",
      background: "rgba(0, 35, 149, 0.6)",
      backdropFilter: "blur(15px)",
      border: "1px solid rgba(254, 203, 0, 0.3)",
      borderRadius: "10px",
      padding: "25px",
      display: "flex",
      flexDirection: "column",
      boxShadow: "0 0 20px rgba(0,0,0,0.5)",
    },
    headerText: {
      color: "#FECB00",
      fontSize: "18px",
      fontWeight: "900",
      letterSpacing: "1px",
      textTransform: "uppercase",
      borderBottom: "2px solid #002F6C",
      paddingBottom: "15px",
      marginBottom: "20px",
      textAlign: "center",
    },
    mainTitle: {
      fontSize: "50px",
      fontWeight: "900",
      color: "#fff",
      textAlign: "center",
      textShadow: "2px 2px 0px #002F6C, 0 0 15px #FECB00",
      marginBottom: "30px",
    },
    input: {
      background: "rgba(255,255,255,0.1)",
      border: "1px solid #444",
      color: "white",
      fontSize: "16px",
      width: "100%",
      padding: "15px",
      textAlign: "center",
      borderRadius: "5px",
      marginBottom: "15px",
      outline: "none",
    },
    btn: (color) => ({
      width: "100%",
      padding: "18px",
      border: "none",
      borderRadius: "5px",
      background:
        color === "blue"
          ? "linear-gradient(to right, #002F6C, #0055A4)"
          : "linear-gradient(to right, #C6363C, #800000)",
      color: "white",
      fontWeight: "bold",
      fontSize: "16px",
      cursor: "pointer",
      textTransform: "uppercase",
      marginTop: "10px",
      boxShadow: "0 4px 0 rgba(0,0,0,0.3)",
    }),
    skinGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gap: "12px",
      overflowY: "auto",
      flex: 1,
      paddingRight: "5px",
      marginBottom: "20px",
      minHeight: "200px",
    },
    skinTile: (active, locked) => ({
      background: active ? "rgba(254, 203, 0, 0.2)" : "rgba(255,255,255,0.05)",
      border: active ? "1px solid #FECB00" : "1px solid #333",
      borderRadius: "5px",
      padding: "15px",
      cursor: locked ? "not-allowed" : "pointer",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      opacity: locked ? 0.6 : 1,
      position: "relative",
    }),
    lockText: {
      fontSize: "10px",
      color: "#ff5555",
      fontWeight: "bold",
      marginTop: "5px",
      textTransform: "uppercase",
      textAlign: "center",
      lineHeight: "1.2",
    },
    row: {
      display: "flex",
      justifyContent: "space-between",
      fontSize: "14px",
      padding: "12px 0",
      borderBottom: "1px solid rgba(255,255,255,0.1)",
    },
    multiMenuContainer: {
      marginTop: "15px",
      background: "rgba(20, 20, 25, 0.9)",
      padding: "15px",
      borderRadius: "5px",
      border: "1px solid #333",
    },
    roomButtonRow: { display: "flex", gap: "10px", marginBottom: "10px" },
    roomButton: {
      flex: 1,
      padding: "10px",
      background: "#444",
      border: "none",
      borderRadius: "4px",
      color: "white",
      cursor: "pointer",
      fontSize: "13px",
      fontWeight: "bold",
    },
    joinRow: { display: "flex", gap: "10px" },
    idInput: {
      flex: 2,
      padding: "10px",
      background: "#111",
      border: "1px solid #333",
      color: "white",
      fontSize: "14px",
      borderRadius: "4px",
      outline: "none",
    },
    joinButton: {
      flex: 1,
      background: "#28a745",
      border: "none",
      color: "white",
      fontSize: "13px",
      cursor: "pointer",
      borderRadius: "4px",
      fontWeight: "bold",
    },
    categoryToggle: { display: "flex", marginBottom: "10px", gap: "5px" },
    catBtn: (active) => ({
      flex: 1,
      padding: "8px",
      background: active ? "#FECB00" : "#222",
      color: active ? "black" : "#888",
      border: "none",
      borderRadius: "4px",
      fontSize: "12px",
      fontWeight: "bold",
      cursor: "pointer",
    }),
    browserModal: {
      position: "fixed", top: 0, left: 0, width: "100%", height: "100%",
      background: "rgba(0,0,0,0.8)", zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "center"
    },
    browserContent: {
      width: "600px", height: "500px", background: "#111", border: "2px solid #FECB00",
      borderRadius: "10px", padding: "20px", display: "flex", flexDirection: "column"
    },
    gameList: {
      flex: 1, overflowY: "auto", marginTop: "15px", border: "1px solid #333", borderRadius: "5px"
    },
    gameItem: {
      display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px",
      borderBottom: "1px solid #333", background: "#222"
    }
  };

  const currentSkins = skinCategory === "normal" ? SKINS_NORMAL : SKINS_SPECIAL;
  const hasLiveGames = activeGames.length > 0;

  return (
    <div style={styles.wrapper}>
      <canvas ref={canvasRef} style={{ display: "block" }} />

      {/* NEW SPECTATE BROWSER MODAL */}
      {showSpectateBrowser && (
          <div style={styles.browserModal}>
              <div style={styles.browserContent}>
                  <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
                      <h2 style={{margin:0, color:"#FECB00"}}>LIVE GAMES</h2>
                      <button onClick={()=>setShowSpectateBrowser(false)} style={{background:"red", color:"white", border:"none", padding:"5px 10px", cursor:"pointer"}}>X</button>
                  </div>
                  <div style={styles.gameList}>
                      {activeGames.length === 0 && <div style={{padding:"20px", color:"#777", textAlign:"center"}}>No active games found. Start playing to appear here!</div>}
                      {activeGames.map(game => (
                          <div key={game.id} style={styles.gameItem}>
                              <div>
                                  <div style={{fontWeight:"bold", color:"white"}}>{game.hostName || "Unknown"}</div>
                                  <div style={{fontSize:"12px", color:"#aaa"}}>
                                      {game.mode === 'single' ? 'Solo' : 'Multiplayer'} | Players: {game.players || 1}
                                  </div>
                              </div>
                              <div style={{display:"flex", alignItems:"center", gap:"15px"}}>
                                  <div style={{textAlign:"right"}}>
                                      <div style={{color:"#4caf50", fontWeight:"bold"}}>Size {Math.round(game.size || 18)}</div>
                                  </div>
                                  <button 
                                    onClick={() => initSpectate(game.id)}
                                    style={{background:"#8A2BE2", color:"white", border:"none", padding:"8px 15px", borderRadius:"4px", cursor:"pointer", fontWeight:"bold"}}
                                  >
                                      WATCH
                                  </button>
                              </div>
                          </div>
                      ))}
                  </div>
              </div>
          </div>
      )}

      {menuState === "start" && (
        <div style={styles.clusterContainer}>
          <div style={styles.statsPanel}>
            <div style={styles.headerText}>Stats</div>
            <div style={styles.row}>
              <span>KILLS</span>
              <span style={{ color: "#FECB00" }}>{userStats.totalKills}</span>
            </div>
            <div style={styles.row}>
              <span>DEATHS</span>
              <span style={{ color: "#FECB00" }}>{userStats.totalDeaths}</span>
            </div>
            <div style={styles.row}>
              <span>BEST SIZE</span>
              <span style={{ color: "#FECB00" }}>
                {userStats.bestScale.toFixed(1)}
              </span>
            </div>
            <div style={styles.row}>
              <span>GAMES</span>
              <span style={{ color: "#FECB00" }}>{userStats.gamesPlayed}</span>
            </div>
            <div
              style={{
                marginTop: "auto",
                paddingTop: "15px",
                borderTop: "1px solid #333",
              }}
            >
              <div
                style={{ fontSize: "11px", color: "#aaa", marginBottom: "8px" }}
              >
                SECRET CODE
              </div>
              <input
                type="text"
                value={redeemCode}
                onChange={(e) => setRedeemCode(e.target.value)}
                style={{
                  ...styles.input,
                  fontSize: "12px",
                  padding: "10px",
                  marginBottom: "8px",
                }}
                placeholder="..."
              />
              <button
                onClick={handleRedeemCode}
                style={{
                  ...styles.btn("red"),
                  padding: "10px",
                  fontSize: "12px",
                  marginTop: "0",
                }}
              >
                REDEEM
              </button>
            </div>
          </div>

          <div style={styles.mainMenu}>
            <div style={styles.mainTitle}>BOSNIA SNAKE</div>

            <div style={{ display: "flex", gap: "15px", marginBottom: "20px" }}>
              <button
                onClick={() => setControlMode("mouse")}
                style={{
                  flex: 1,
                  padding: "12px",
                  background: controlMode === "mouse" ? "#FECB00" : "#222",
                  color: controlMode === "mouse" ? "black" : "#888",
                  border: "none",
                  borderRadius: "4px",
                  fontWeight: "bold",
                  cursor: "pointer",
                  fontSize: "14px",
                }}
              >
                MOUSE
              </button>
              <button
                onClick={() => setControlMode("keyboard")}
                style={{
                  flex: 1,
                  padding: "12px",
                  background: controlMode === "keyboard" ? "#FECB00" : "#222",
                  color: controlMode === "keyboard" ? "black" : "#888",
                  border: "none",
                  borderRadius: "4px",
                  fontWeight: "bold",
                  cursor: "pointer",
                  fontSize: "14px",
                }}
              >
                KEYBOARD
              </button>
            </div>

            <div
              style={{
                fontSize: "12px",
                color: "#aaa",
                marginBottom: "5px",
                textTransform: "uppercase",
              }}
            >
              SELECT SKIN
            </div>

            <div style={styles.categoryToggle}>
              <button
                onClick={() => setSkinCategory("normal")}
                style={styles.catBtn(skinCategory === "normal")}
              >
                NORMAL
              </button>
              <button
                onClick={() => setSkinCategory("special")}
                style={styles.catBtn(skinCategory === "special")}
              >
                SPECIAL
              </button>
            </div>

            <div style={styles.skinGrid}>
              {currentSkins.map((skin) => {
                const unlocked = isSkinUnlocked(skin);
                const req = UNLOCK_CRITERIA[skin];
                return (
                  <div
                    key={skin}
                    onClick={() => {
                      if (unlocked) setSelectedSkin(skin);
                    }}
                    style={styles.skinTile(selectedSkin === skin, !unlocked)}
                  >
                    <div
                      style={{
                        width: "25px",
                        height: "25px",
                        borderRadius: "50%",
                        background: SKIN_BODY_COLORS[skin],
                        marginBottom: "8px",
                        border: "1px solid white",
                      }}
                    ></div>
                    <div
                      style={{
                        fontSize: "12px",
                        fontWeight: "bold",
                        textTransform: "capitalize",
                        color: unlocked ? "white" : "#888",
                      }}
                    >
                      {skin.replace("_", " ")}
                    </div>
                    {!unlocked && (
                      <div style={styles.lockText}>🔒 {req.label}</div>
                    )}
                  </div>
                );
              })}
            </div>

            <input
              type="text"
              placeholder="NICKNAME"
              value={playerName}
              onChange={handleNameChange}
              style={styles.input}
            />
            <button onClick={initSinglePlayer} style={styles.btn("blue")}>
              PLAY SOLO
            </button>
            <button
              onClick={() => setShowMultiMenu(!showMultiMenu)}
              style={styles.btn("red")}
            >
              MULTIPLAYER
            </button>
            <button
              onClick={() => setShowSpectateBrowser(true)}
              style={{
                  ...styles.btn("blue"), 
                  background: hasLiveGames 
                    ? "linear-gradient(to right, #00C853, #007E33)" // Green if games exist
                    : "linear-gradient(to right, #555, #333)",     // Grey if no games
                  opacity: hasLiveGames ? 1 : 0.7
              }}
            >
              SPECTATE LIVE ({activeGames.length})
            </button>

            {showMultiMenu && (
              <div style={styles.multiMenuContainer}>
                <div style={styles.roomButtonRow}>
                  <button
                    onClick={() => handleQuickPlay(1)}
                    style={styles.roomButton}
                  >
                    Room 1
                  </button>
                  <button
                    onClick={() => handleQuickPlay(2)}
                    style={styles.roomButton}
                  >
                    Room 2
                  </button>
                </div>
                <div style={styles.joinRow}>
                  <input
                    type="text"
                    placeholder="Room ID"
                    value={connectId}
                    onChange={(e) => setConnectId(e.target.value)}
                    style={styles.idInput}
                  />
                  <button
                    onClick={() => initHost(connectId)}
                    style={styles.joinButton}
                  >
                    JOIN
                  </button>
                </div>
              </div>
            )}
          </div>

          <div style={styles.leaderboardPanel}>
            <div style={styles.headerText}>Top 5</div>
            {leaderboard.map((l, i) => (
              <div key={i} style={styles.row}>
                <div style={{ display: "flex", alignItems: "center" }}>
                  <span
                    style={{
                      color: i === 0 ? "#FECB00" : "#888",
                      fontWeight: "bold",
                      width: "25px",
                    }}
                  >
                    {i + 1}.
                  </span>
                  <span
                    style={{
                      color: "white",
                      maxWidth: "120px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {l.name}
                  </span>
                </div>
                <span style={{ color: "#4caf50", fontWeight: "bold" }}>
                  {Math.round(l.size)}
                </span>
              </div>
            ))}
            {leaderboard.length === 0 && (
              <div
                style={{
                  textAlign: "center",
                  color: "#888",
                  marginTop: "20px",
                }}
              >
                Loading...
              </div>
            )}
          </div>
        </div>
      )}

      {menuState === "multi_lobby" && (
        <div
          style={{
            ...styles.mainMenu,
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
          }}
        >
          <div style={styles.headerText}>LOBBY</div>
          <div
            style={{
              background: "#111",
              padding: "20px",
              borderRadius: "5px",
              textAlign: "center",
              marginBottom: "20px",
            }}
          >
            <div style={{ fontSize: "12px", color: "#aaa" }}>YOUR ROOM ID</div>
            <div
              style={{
                color: "#FECB00",
                fontSize: "22px",
                fontWeight: "bold",
                userSelect: "all",
                marginTop: "5px",
              }}
            >
              {myId}
            </div>
          </div>
          <div
            style={{
              textAlign: "center",
              marginBottom: "25px",
              color: "white",
              fontSize: "18px",
            }}
          >
            Players:{" "}
            <span style={{ fontWeight: "bold", color: "#4caf50" }}>
              {lobbyCount}
            </span>
          </div>
          {isHost ? (
            <button onClick={handleHostStart} style={styles.btn("blue")}>
              START GAME
            </button>
          ) : (
            <div style={{ textAlign: "center", color: "#aaa" }}>
              Waiting for host...
            </div>
          )}
        </div>
      )}

      {showOwnerLogin && (
        <div
          style={{
            position: "absolute",
            top: "10px",
            left: "50%",
            transform: "translateX(-50%)",
            background: "black",
            padding: "10px",
            border: "1px solid red",
          }}
        >
          <form onSubmit={handleOwnerLogin}>
            <input
              type="password"
              value={ownerPasswordInput}
              onChange={(e) => setOwnerPasswordInput(e.target.value)}
              style={{ background: "#222", color: "red", border: "none" }}
            />
          </form>
        </div>
      )}
      {showOwnerPanel && (
        <div
          style={{
            position: "absolute",
            top: "50px",
            left: "10px",
            background: "rgba(0,0,0,0.8)",
            padding: "10px",
            border: "1px solid red",
            color: "white",
          }}
        >
          <button
            onClick={toggleGodMode}
            style={{ display: "block", marginBottom: "5px" }}
          >
            GodMode
          </button>
          <button
            onClick={toggleSpeedHack}
            style={{ display: "block", marginBottom: "5px" }}
          >
            Speed
          </button>
          <button
            onClick={() => cheatSetSize(50)}
            style={{ display: "block", marginBottom: "5px" }}
          >
            Size 50
          </button>
          <button onClick={cheatKillBots} style={{ display: "block" }}>
            Kill Bots
          </button>
          <div>{cheatMsg}</div>
        </div>
      )}
    </div>
  );
}
