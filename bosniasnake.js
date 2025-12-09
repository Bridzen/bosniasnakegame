--- START OF FILE bosniasnake.js ---

import React, { useEffect, useRef, useState } from "react";
import Peer from "peerjs";

// --- FIREBASE IMPORTS ---
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import {
  getFirestore,
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  addDoc,
  serverTimestamp,
  where,
  getDocs,
  updateDoc,
  doc,
  setDoc,
  deleteDoc,
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
  } else if (type === "chat") {
    const osc = audioCtx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.linearRampToValueAtTime(1200, now + 0.1);
    osc.connect(gainNode);
    gainNode.gain.setValueAtTime(0.05, now);
    gainNode.gain.linearRampToValueAtTime(0, now + 0.1);
    osc.start(now);
    osc.stop(now + 0.1);
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

// --- INITIALIZE DATABASE ---
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// --- GAMEPLAY CONFIGURATION ---
const OWNER_PASSWORD = "Roblox13_isme";
const CELL = 150;
const GRID = 80;
const WORLD_SIZE = CELL * GRID;
const MIN_LENGTH = 140;
const SPRINT_COST = 0.5;

// --- SPEED CONFIGURATION ---
const BASE_SPEED = 4.2;
const TURN_SPEED = 0.09;
const MAX_ENEMIES = 8;
const SIZE_GAIN_PER_LEVEL = 0.25;
const FOOD_RADIUS_BASE = 6;
const LENGTH_GAIN = 8;
const BROADCAST_RATE = 50;
const INTERPOLATION_SPEED = 0.2;

// --- SKIN CONFIGURATION ---
const SKINS_NORMAL = [
  "bosnia",
  "italy",
  "poland",
  "france",
  "germany",
  "ukraine",
  "sweden",
  "denmark",
  "uk",
  "usa",
  "russia",
  "canada",
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
  usa: "#3C3B6E",
  denmark: "#C60C30",
  sweden: "#006AA7",
  poland: "#DC143C",
  italy: "#008C45",
  uk: "#012169",
};

// --- UNLOCK CRITERIA ---
const UNLOCK_CRITERIA = {
  bosnia: { type: "default", label: "Default" },
  italy: { type: "default", label: "Default" },
  germany: { type: "scale", val: 40, label: "Reach Size 40" },
  france: { type: "deaths", val: 5, label: "Die 5 Times" },
  sweden: { type: "kills", val: 10, label: "Get 10 Kills" },
  denmark: { type: "kills", val: 25, label: "Get 25 Kills" },
  poland: { type: "deaths", val: 15, label: "Die 15 Times" },
  uk: { type: "length", val: 800, label: "Reach Length 800" },
  ukraine: { type: "games", val: 5, label: "Play 5 Games" },
  canada: { type: "length", val: 1000, label: "Reach Length 1k" },
  russia: { type: "scale", val: 50, label: "Reach Size 50" },
  usa: { type: "scale", val: 75, label: "Reach Size 75" },
  ireland: { type: "code", label: "Secret Code" },
  soviet: { type: "custom_soviet", label: "Russia + Size 500 + 50 Kills" },
  golden_maple: {
    type: "custom_maple",
    label: "Canada + Size 250 + 150 Kills",
  },
};

// --- UTILS ---
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

export default function BosniaSnakeFixedRuntime() {
  const canvasRef = useRef(null);

  // --- UI STATES ---
  const [menuState, setMenuState] = useState("start");
  const [controlMode, setControlMode] = useState("mouse");
  const [skinCategory, setSkinCategory] = useState("normal");
  const [selectedSkin, setSelectedSkin] = useState("bosnia");
  const [myId, setMyId] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [myPlayerIndex, setMyPlayerIndex] = useState(0);
  const [playerName, setPlayerName] = useState("");
  const [leaderboard, setLeaderboard] = useState([]);
  const [redeemCode, setRedeemCode] = useState("");

  // --- SPECTATOR & CHAT STATES ---
  const [spectateList, setSpectateList] = useState([]);
  const [isSpectating, setIsSpectating] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [authReady, setAuthReady] = useState(false);

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

  // --- GAME ENGINE REFS ---
  const cheats = useRef({ godMode: false, speedHack: false });
  const peerRef = useRef(null);
  const connections = useRef([]);
  const hostConn = useRef(null);
  const lastSentTime = useRef(0);
  const serverState = useRef(null);
  const mouse = useRef({ x: 0, y: 0 });
  const keys = useRef({});

  // Use a ref to store current render/update functions to avoid stale closures during development hot-reloads
  const gameLogicRef = useRef({});

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

  // --- AUTH AND SCANNER ---
  useEffect(() => {
    signInAnonymously(auth)
      .then(() => {
        console.log("Authenticated");
      })
      .catch((err) => {
        console.warn("Auth warning:", err);
      })
      .finally(() => {
        setAuthReady(true);
      });
  }, []);

  useEffect(() => {
    const scanForGames = async () => {
      setIsScanning(true);
      try {
        const gamesRef = collection(db, "active_games");
        const q = query(gamesRef, orderBy("lastBeat", "desc"), limit(20));
        const querySnapshot = await getDocs(q);
        const games = [];
        const now = Date.now();
        querySnapshot.forEach((doc) => {
          const data = doc.data();
          if (data.lastBeat) {
            const diff = now - data.lastBeat.toMillis();
            if (diff < 30000) {
              games.push({ id: doc.id, ...data });
            }
          }
        });
        setSpectateList(games);
      } catch (err) {
        console.error("Scanner error:", err);
      } finally {
        setIsScanning(false);
      }
    };
    scanForGames();
    const interval = setInterval(scanForGames, 15000);
    return () => clearInterval(interval);
  }, []);

  // --- DATA LOADING ---
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

    const q = query(
      collection(db, "leaderboard"),
      orderBy("size", "desc"),
      limit(5)
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const lbData = snapshot.docs.map((doc) => doc.data());
        setLeaderboard(lbData);
      },
      (error) => {
        console.warn("Leaderboard failed (likely permissions)");
      }
    );

    return () => unsubscribe();
  }, []);

  const handleNameChange = (e) => {
    setPlayerName(e.target.value);
    localStorage.setItem("bosnia_snake_username", e.target.value);
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
      if (updates.kill) {
        next.totalKills++;
        changed = true;
      }
      if (updates.death) {
        next.totalDeaths++;
        changed = true;
      }
      if (updates.game) {
        next.gamesPlayed++;
        changed = true;
      }
      if (
        updates.unlockSecret &&
        !next.unlockedSecrets.includes(updates.unlockSecret)
      ) {
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
    if (skin === "soviet") {
      return (
        isSkinUnlocked("russia") &&
        userStats.bestScale >= 500 &&
        userStats.totalKills >= 50
      );
    }
    if (skin === "golden_maple") {
      return (
        isSkinUnlocked("canada") &&
        userStats.bestScale >= 250 &&
        userStats.totalKills >= 150
      );
    }
    if (req.type === "default") return true;
    if (req.type === "code")
      return (
        userStats.unlockedSecrets && userStats.unlockedSecrets.includes(skin)
      );
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

  // --- CONTROLS ---
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
      if (document.activeElement && document.activeElement.tagName === "INPUT")
        return;
      if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
      if (e.key === "`" || e.key === "~") {
        e.preventDefault();
        if (showOwnerPanel) setShowOwnerPanel(false);
        else setShowOwnerLogin((p) => !p);
        return;
      }
      keys.current[e.key.toLowerCase()] = true;
    };
    const handleUp = (e) => {
      if (document.activeElement && document.activeElement.tagName === "INPUT")
        return;
      keys.current[e.key.toLowerCase()] = false;
    };
    const handleMouseMove = (e) => {
      mouse.current.x = e.clientX;
      mouse.current.y = e.clientY;
    };
    const handleMouseDown = (e) => {
      const me = gameState.current.players[myPlayerIndex];
      // Explicit reset call if dead
      if (me && me.dead && menuState === "playing" && !isSpectating) {
        resetWorld(true);
      }
    };
    const handleTouchStart = (e) => {
      if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
      mouse.current.x = e.touches[0].clientX;
      mouse.current.y = e.touches[0].clientY;

      const me = gameState.current.players[myPlayerIndex];
      if (me && me.dead && menuState === "playing" && !isSpectating) {
        resetWorld(true);
      }
    };
    const handleTouchMove = (e) => {
      mouse.current.x = e.touches[0].clientX;
      mouse.current.y = e.touches[0].clientY;
      if (e.target === canvasRef.current) e.preventDefault();
    };

    window.addEventListener("keydown", handleDown);
    window.addEventListener("keyup", handleUp);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("touchstart", handleTouchStart, { passive: false });
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    return () => {
      window.removeEventListener("keydown", handleDown);
      window.removeEventListener("keyup", handleUp);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      if (peerRef.current) peerRef.current.destroy();
    };
  }, [showOwnerPanel, menuState, isSpectating, myPlayerIndex]);

  const getLocalInput = () => {
    if (isSpectating)
      return {
        targetAngle: null,
        sprint: false,
        respawn: false,
        triggerAbility: false,
      };
    const sprint = keys.current["shift"] || keys.current["/"];
    const respawn = keys.current[" "];
    const triggerAbility = keys.current["e"];
    let targetAngle = null;
    if (controlMode === "mouse") {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      targetAngle = Math.atan2(mouse.current.y - cy, mouse.current.x - cx);
    } else {
      let dx = 0,
        dy = 0;
      if (keys.current["w"] || keys.current["arrowup"]) dy -= 1;
      if (keys.current["s"] || keys.current["arrowdown"]) dy += 1;
      if (keys.current["a"] || keys.current["arrowleft"]) dx -= 1;
      if (keys.current["d"] || keys.current["arrowright"]) dx += 1;
      if (dx !== 0 || dy !== 0) targetAngle = Math.atan2(dy, dx);
    }
    return { targetAngle, sprint, respawn, triggerAbility };
  };

  // --- CHEAT FUNCTIONS ---
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

  // --- NETWORK DATA COMPRESSION ---
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
      lastTick: m.lastTick,
      timer: m.timer,
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
      name: p.name || "Unknown",
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

  // --- REFRESH LOGIC REF ---
  // This hook ensures that every render, the ref points to the LATEST version of the functions.
  // This solves the problem where the loop keeps running old code after you save the file.
  useEffect(() => {
    gameLogicRef.current = {
      updateSinglePlayer,
      renderGame,
      updateSpectatorInterpolation,
    };
  });

  // --- GAME LOOP ---
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
        // --- RETRIEVE FRESH LOGIC FROM REF ---
        const logic = gameLogicRef.current;
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

        if (isHost && logic.updateSinglePlayer) {
          logic.updateSinglePlayer(); // Call the latest version
          if (timestamp - lastSentTime.current > BROADCAST_RATE) {
            const payload = { type: "STATE", state: compressState(state) };
            connections.current.forEach((c) => {
              if (c.open) c.send(payload);
            });
            lastSentTime.current = timestamp;
          }
        } else if (isSpectating && logic.updateSpectatorInterpolation) {
          logic.updateSpectatorInterpolation();
        }

        let renderIndex = myPlayerIndex;
        if (isSpectating && state.players.length > 0) {
          renderIndex = 0;
        }
        if (logic.renderGame) {
          logic.renderGame(ctx, canvas, renderIndex); // Call the latest version
        }
      }
      animationId = requestAnimationFrame(loop);
    };
    animationId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", handleResize);
    };
  }, [menuState, isHost, myPlayerIndex, controlMode, isSpectating]);

  // --- PUBLISH ACTIVE GAME TO FIRESTORE ---
  const publishGamePresence = (pid, pName) => {
    if (!pid) return;
    const docRef = doc(db, "active_games", pid);
    setDoc(docRef, {
      host: pName,
      lastBeat: serverTimestamp(),
    }).catch((err) => console.warn("Presence publish failed:", err.code));
  };

  const initSinglePlayer = () => {
    if (peerRef.current) peerRef.current.destroy();
    const peer = new Peer();
    peerRef.current = peer;
    connections.current = [];

    peer.on("open", (id) => {
      setMyId(id);
      setIsHost(true);
      setIsSpectating(false);
      setMyPlayerIndex(0);

      publishGamePresence(id, playerName);
      const hb = setInterval(() => publishGamePresence(id, playerName), 5000);

      updateStats({ game: true });
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
          name: playerName,
        },
      ];
      resetWorld(true);
      setMenuState("playing");
      setChatMessages([]);

      peer.on("connection", (conn) => {
        connections.current.push(conn);
        conn.on("data", (data) => {
          if (data.type === "CHAT") {
            const msg = { name: data.name, text: data.text, color: "#aaa" };
            setChatMessages((prev) => [...prev.slice(-9), msg]);
            playSound("chat");
            broadcastChat(msg);
          }
        });
        conn.on("close", () => {
          connections.current = connections.current.filter((c) => c !== conn);
        });
      });

      peer.on("disconnected", () => {
        clearInterval(hb);
        deleteDoc(doc(db, "active_games", id)).catch((e) =>
          console.warn("Delete failed")
        );
      });
    });
  };

  const broadcastChat = (msg) => {
    connections.current.forEach((c) => {
      if (c.open) c.send({ type: "CHAT_MSG", msg });
    });
  };

  const handleSendChat = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const msg = {
      name: playerName,
      text: chatInput,
      color: isHost ? "#FECB00" : "#fff",
    };

    if (isHost) {
      setChatMessages((prev) => [...prev.slice(-9), msg]);
      playSound("chat");
      broadcastChat(msg);
    } else {
      if (hostConn.current && hostConn.current.open) {
        hostConn.current.send({
          type: "CHAT",
          name: playerName,
          text: chatInput,
        });
        setChatMessages((prev) => [...prev.slice(-9), msg]);
      }
    }
    setChatInput("");
  };

  const initSpectate = (idToJoin) => {
    if (!idToJoin) return;
    if (peerRef.current) peerRef.current.destroy();

    // @ts-ignore
    const peer = new Peer();
    peerRef.current = peer;

    peer.on("open", () => {
      const conn = peer.connect(idToJoin);
      hostConn.current = conn;
      setIsHost(false);
      setIsSpectating(true);

      conn.on("open", () => {
        setMenuState("playing");
        setChatMessages([
          { name: "System", text: "Connected to host.", color: "cyan" },
        ]);
      });

      conn.on("data", (data) => {
        if (data.type === "STATE") {
          serverState.current = data.state;
          if (!gameState.current.players.length) {
            const freshState = JSON.parse(JSON.stringify(data.state));
            freshState.players.forEach((p) => (p.body = p.body || []));
            freshState.enemies.forEach((e) => (e.body = e.body || []));
            gameState.current = freshState;
          }
        }
        if (data.type === "CHAT_MSG") {
          setChatMessages((prev) => [...prev.slice(-9), data.msg]);
          playSound("chat");
        }
      });
      conn.on("close", () => {
        alert("Host Disconnected");
        setMenuState("start");
        setIsSpectating(false);
      });
    });
    peer.on("error", (err) => {
      alert("Spectate Error: " + err.type);
    });
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
    if (p && p.dead) {
      if (keys.current["r"]) resetWorld(true);
      return;
    }

    state.enemies = state.enemies.filter((e) => e.alive);
    if (state.enemies.length < MAX_ENEMIES && Math.random() < 0.02)
      spawnOneEnemy();

    const inp = getLocalInput();
    if (p) handlePhysics(p, inp);
    updateAI();
    if (p) updateEnvironment([p]);
  }

  function updateSpectatorInterpolation() {
    if (!serverState.current) return;
    const cur = gameState.current;
    const tar = serverState.current;

    cur.food = tar.food.map((f) => ({
      x: f.x,
      y: f.y,
      level: f.l,
      isGolden: f.g === 1,
    }));
    cur.mines = tar.mines.map((m) => ({
      ...m,
      lastTick: m.lastTick || Date.now(),
      timer: m.timer || 3,
    }));
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
      if (!e.body) e.body = [];
      if (e.alive) {
        e.body.unshift({ x: e.x, y: e.y });
        while (e.body.length > 140) e.body.pop();
      }
    });

    if (cur.players.length !== tar.players.length)
      cur.players = tar.players.map((p) => ({ ...p, body: [] }));

    cur.players.forEach((p, i) => {
      const tP = tar.players[i];
      if (!tP) return;
      p.x = lerp(p.x, tP.x, INTERPOLATION_SPEED);
      p.y = lerp(p.y, tP.y, INTERPOLATION_SPEED);
      p.angle = lerpAngle(p.angle, tP.angle, INTERPOLATION_SPEED);
      p.dead = tP.dead;
      p.scale = tP.scale;
      p.length = tP.length;
      p.kills = tP.kills;
      p.deaths = tP.deaths;
      p.frozenUntil = tP.frozenUntil;
      p.abilityActive = tP.abilityActive;
      p.maplePhase = tP.maplePhase;
      p.name = tP.name;
      if (!p.body) p.body = [];
      if (!p.dead) {
        p.body.unshift({ x: p.x, y: p.y });
        while (p.body.length > p.length) p.body.pop();
      } else {
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
      if (
        inp.sprint &&
        !p.barrageActive &&
        (!p.lastAbilityTime || now - p.lastAbilityTime > 60000)
      ) {
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
            gameState.current.shakeIntensity = Math.min(
              60,
              gameState.current.shakeIntensity + 10
            );
            p.nextExplosionTime = now + 200;
            if (dist(p, gameState.current.players[0]) < 900)
              playSound("soviet_boom");
            const killRad = 3 * CELL;
            gameState.current.enemies.forEach((e) => {
              if (e.alive && dist(e, p) < killRad) killEnemy(e, p);
            });
          }
        }
      }
    }

    if (p.country === "golden_maple") {
      if (
        inp.triggerAbility &&
        (!p.lastAbilityTime || now - p.lastAbilityTime > 60000) &&
        !p.maplePhase
      ) {
        p.maplePhase = "harvest";
        p.phaseEndTime = now + 2500;
        p.lastAbilityTime = now;
        if (dist(p, gameState.current.players[0]) < 900) playSound("angelic");
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
        if (now > p.phaseEndTime) p.maplePhase = null;
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

    const canSprint =
      inp.sprint &&
      p.length > MIN_LENGTH &&
      (!p.abilityActive || p.country === "soviet");
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

      // UPDATED: Aggressive AI Growth Logic
      if (!enemy.baseScale) enemy.baseScale = 12;
      const currentCalculatedWidth =
        12 + Math.min(60, (enemy.length - 140) / 8); // Faster width growth
      if (currentCalculatedWidth > enemy.baseScale)
        enemy.baseScale = currentCalculatedWidth;
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
        if (!p.dead && p.active) {
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
        if (!p.dead && p.active) {
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
        targetAngle = Math.atan2(
          enemy.y - criticalThreat.y,
          enemy.x - criticalThreat.x
        );
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

        let dangerLeft = 0,
          dangerRight = 0,
          blockedCenter = false;
        const checkPointDanger = (px, py) => {
          const limit = WORLD_SIZE / 2 - 100;
          if (px < -limit || px > limit || py < -limit || py > limit)
            return 300;
          for (let m of state.mines)
            if (dist({ x: px, y: py }, m) < 220) return 2000;
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
              if (f.type.includes("left")) dangerLeft += danger / s;
              if (f.type.includes("right")) dangerRight += danger / s;
              if (f.type === "center") blockedCenter = true;
            }
          }
        });

        if (dangerLeft > 0 || dangerRight > 0 || blockedCenter) {
          if (dangerLeft > dangerRight) targetAngle += 2.5;
          else if (dangerRight > dangerLeft) targetAngle -= 2.5;
          else targetAngle += 3.0;
        } else if (panicMine) {
          targetAngle = Math.atan2(
            enemy.y - panicMine.y,
            enemy.x - panicMine.x
          );
          forceSprint = true;
        } else if (enemy.isEnraged && target) {
          const playerSpeed =
            target.length < target.length - 1 ? BASE_SPEED * 1.8 : BASE_SPEED;
          const lookAhead = Math.min(60, minDist / 5);
          const predX =
            target.x + Math.cos(target.angle) * playerSpeed * lookAhead;
          const predY =
            target.y + Math.sin(target.angle) * playerSpeed * lookAhead;
          targetAngle = Math.atan2(predY - enemy.y, predX - enemy.x);
          if (
            Math.abs(normalizeAngle(targetAngle - enemy.angle)) < 0.3 &&
            minDist > 150
          )
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
            targetAngle = Math.atan2(
              closestFood.y - enemy.y,
              closestFood.x - enemy.x
            );
        }
      }

      let diff = normalizeAngle(targetAngle - enemy.angle);
      const turn =
        (forceSprint ? enemy.turnSpeed * 1.5 : enemy.turnSpeed) * aiTurnMult;

      if (Math.abs(diff) < turn) enemy.angle = targetAngle;
      else if (diff > 0) enemy.angle += turn;
      else enemy.angle -= turn;
      enemy.angle = normalizeAngle(enemy.angle);

      const spd =
        (forceSprint && enemy.length > 145 ? enemy.boostSpeed : enemy.speed) *
        aiSpeedMult;
      if (forceSprint && enemy.length > 145) enemy.length -= 0.3;

      enemy.x += Math.cos(enemy.angle) * spd;
      enemy.y += Math.sin(enemy.angle) * spd;
      enemy.body.unshift({ x: enemy.x, y: enemy.y });
      while (enemy.body.length > enemy.length) enemy.body.pop();

      for (let i = state.food.length - 1; i >= 0; i--) {
        if (coll(enemy, state.food[i], enemy.width + 10)) {
          state.food.splice(i, 1);
          // UPDATED: Much faster growth for AI (+20 length per food)
          enemy.length += 20;
        }
      }

      state.players.forEach((p) => {
        if (!p.dead && p.active) {
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
        if (!p.dead && coll(p, f, p.scale + rad)) {
          if (p.id === myPlayerIndex) playSound("eat");
          s.food.splice(i, 1);
          const multiplier = f.isGolden ? 3 : 1;
          p.length += LENGTH_GAIN * multiplier;
          p.scale = Math.min(
            600,
            p.scale + foodLevel * SIZE_GAIN_PER_LEVEL * multiplier
          );
        }
      });
    });
    for (let i = s.mines.length - 1; i >= 0; i--) {
      let m = s.mines[i];
      if (m.state === "idle") {
        let triggered = false;
        active.forEach((p) => {
          if (!p.dead && dist(p, m) < 200) triggered = true;
        });
        if (triggered) {
          m.state = "triggered";
          m.lastTick = now;
        }
      } else if (m.state === "triggered") {
        if (now - m.lastTick > m.timer * 1000) {
          createExplosion(m.x, m.y);
          active.forEach((p) => {
            if (!p.dead && dist(p, m) < 300) killPlayer(p, null);
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
    if (victim.dead) return;
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
      if (killer.id === myPlayerIndex) updateStats({ kill: true });
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

  // --- RENDER ---
  function renderGame(ctx, canvas, pIdx) {
    const state = gameState.current;
    const dpr = window.devicePixelRatio || 1;
    const me = state.players[pIdx] ||
      state.players[0] || { x: 0, y: 0, scale: 18, body: [] };
    const startScale = 18;
    const zoom = Math.max(
      0.1,
      0.6 * (30 / (30 + (me.scale - startScale) * 0.4))
    );

    let sx = 0,
      sy = 0;
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

    // UPDATED: SERBIAN MINES (With aggressive warning)
    state.mines.forEach((m) => {
      const r = 35; // Mine Size

      // WARNING FLASH (RED BLAST RADIUS)
      if (m.state === "triggered") {
        const timeElapsed = (Date.now() - m.lastTick) / 1000;
        // Pulse faster as time runs out
        const pulseSpeed = 150 - timeElapsed * 40; 
        const pulse = (Date.now() % Math.max(50, pulseSpeed)) / Math.max(50, pulseSpeed);
        
        ctx.beginPath();
        // Expands as time goes on
        ctx.arc(m.x, m.y, 300 * (timeElapsed / 3), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 0, 0, ${0.1 + pulse * 0.3})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(255, 0, 0, ${0.5 + pulse * 0.5})`;
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      ctx.save();
      // Circular clip for the mine body
      ctx.beginPath();
      ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
      ctx.clip();

      // SERBIA FLAG COLORS
      const serbRed = "#C6363C";
      const serbBlue = "#0C4076";
      const serbWhite = "#FFFFFF";

      // Top Red
      ctx.fillStyle = serbRed;
      ctx.fillRect(m.x - r, m.y - r, r * 2, (r * 2) / 3);
      // Mid Blue
      ctx.fillStyle = serbBlue;
      ctx.fillRect(m.x - r, m.y - r + (r * 2) / 3, r * 2, (r * 2) / 3);
      // Bot White
      ctx.fillStyle = serbWhite;
      ctx.fillRect(m.x - r, m.y - r + (2 * (r * 2)) / 3, r * 2, (r * 2) / 3);

      // SERBIAN CREST (Simplified) on the left
      const cx = m.x - r * 0.3;
      const cy = m.y;
      const cr = r * 0.45;
      // White Eagle Body
      ctx.fillStyle = "white";
      ctx.beginPath();
      ctx.moveTo(cx, cy - cr); // Top
      ctx.quadraticCurveTo(cx + cr, cy - cr * 0.5, cx + cr, cy); // Right wing
      ctx.quadraticCurveTo(cx, cy + cr, cx, cy + cr); // Bottom
      ctx.quadraticCurveTo(cx - cr, cy, cx - cr, cy); // Left wing
      ctx.fill();
      // Red Shield
      ctx.fillStyle = serbRed;
      ctx.beginPath();
      ctx.rect(cx - cr * 0.4, cy - cr * 0.2, cr * 0.8, cr * 0.6);
      ctx.fill();

      ctx.restore();

      // Border
      ctx.strokeStyle = m.state === "triggered" ? "red" : "#333";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
      ctx.stroke();

      // COUNTDOWN WARNING TEXT
      if (m.state === "triggered") {
        const remaining = Math.max(
          0,
          (3.0 - (Date.now() - m.lastTick) / 1000).toFixed(1)
        );
        ctx.fillStyle = "white";
        ctx.strokeStyle = "black";
        ctx.lineWidth = 4;
        ctx.font = "bold 24px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.strokeText(remaining, m.x, m.y);
        ctx.fillText(remaining, m.x, m.y);
      }
    });

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Players
    state.players.forEach((pl) => {
      if (!pl.active || pl.dead) return;
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

      // BODY COLOR LOGIC
      if (pl.country === "golden_maple") {
        // Dynamic Gold Shine Gradient for Body
        const gradient = ctx.createLinearGradient(
          pl.x - 50,
          pl.y - 50,
          pl.x + 50,
          pl.y + 50
        );
        gradient.addColorStop(0, "#B8860B"); // Dark Goldenrod
        gradient.addColorStop(0.5, "#FFD700"); // Gold
        gradient.addColorStop(1, "#DAA520"); // Goldenrod
        ctx.strokeStyle = gradient;
      } else {
        ctx.strokeStyle =
          pl.frozenUntil && Date.now() < pl.frozenUntil ? "cyan" : pl.colorBody;
      }

      ctx.beginPath();
      if (pl.body.length) {
        ctx.moveTo(pl.body[0].x, pl.body[0].y);
        pl.body.forEach((b) => ctx.lineTo(b.x, b.y));
        ctx.stroke();
      }
      ctx.shadowBlur = 0;

      // HEAD RENDERING
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
      } else if (pl.country === "italy") {
        ctx.fillStyle = "#008C45";
        ctx.fillRect(-r, -r, (r * 2) / 3, r * 2);
        ctx.fillStyle = "white";
        ctx.fillRect(-r + (r * 2) / 3, -r, (r * 2) / 3, r * 2);
        ctx.fillStyle = "#CD212A";
        ctx.fillRect(-r + (2 * r * 2) / 3, -r, (r * 2) / 3, r * 2);
      } else if (pl.country === "poland") {
        ctx.fillStyle = "white";
        ctx.fillRect(-r, -r, r * 2, r); // Top half
        ctx.fillStyle = "#DC143C";
        ctx.fillRect(-r, 0, r * 2, r); // Bottom half
      } else if (pl.country === "sweden") {
        ctx.fillStyle = "#006AA7"; // Blue
        ctx.fillRect(-r, -r, r * 2, r * 2);
        ctx.fillStyle = "#FECC00"; // Yellow
        ctx.fillRect(-r, -r * 0.2, r * 2, r * 0.4); // Horiz
        ctx.fillRect(-r * 0.2, -r, r * 0.4, r * 2); // Vert
      } else if (pl.country === "denmark") {
        ctx.fillStyle = "#C60C30"; // Red
        ctx.fillRect(-r, -r, r * 2, r * 2);
        ctx.fillStyle = "white";
        ctx.fillRect(-r, -r * 0.2, r * 2, r * 0.4); // Horiz
        ctx.fillRect(-r * 0.2, -r, r * 0.4, r * 2); // Vert
      } else if (pl.country === "uk") {
        ctx.fillStyle = "#012169"; // Blue
        ctx.fillRect(-r, -r, r * 2, r * 2);
        // White Cross
        ctx.fillStyle = "white";
        ctx.fillRect(-r, -r * 0.3, r * 2, r * 0.6);
        ctx.fillRect(-r * 0.3, -r, r * 0.6, r * 2);
        // White Diagonals (Simplified)
        ctx.save();
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-r * 2, -r * 0.15, r * 4, r * 0.3);
        ctx.rotate(Math.PI / 2);
        ctx.fillRect(-r * 2, -r * 0.15, r * 4, r * 0.3);
        ctx.restore();
        // Red Cross
        ctx.fillStyle = "#C8102E";
        ctx.fillRect(-r, -r * 0.15, r * 2, r * 0.3);
        ctx.fillRect(-r * 0.15, -r, r * 0.3, r * 2);
      } else if (pl.country === "usa") {
        // White Base
        ctx.fillStyle = "white";
        ctx.fillRect(-r, -r, r * 2, r * 2);
        // Red Stripes
        ctx.fillStyle = "#B22234";
        for (let i = 0; i < 7; i++) {
          ctx.fillRect(-r, -r + (i * 2 * r) / 7, r * 2, r / 7);
        }
        // Blue Canton (Top Left)
        ctx.fillStyle = "#3C3B6E";
        ctx.fillRect(-r, -r, r, r * 0.8);
        // Stars (Simple Dots)
        ctx.fillStyle = "white";
        for (let py = 0; py < 3; py++) {
          for (let px = 0; px < 4; px++) {
            ctx.beginPath();
            ctx.arc(-r + 10 + px * 15, -r + 10 + py * 15, 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      } else if (pl.country === "ireland") {
        ctx.fillStyle = "#169B62";
        ctx.fillRect(-r, -r, (r * 2) / 3, r * 2);
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(-r + (r * 2) / 3, -r, (r * 2) / 3, r * 2);
        ctx.fillStyle = "#FF883E";
        ctx.fillRect(-r + (2 * r * 2) / 3, -r, (r * 2) / 3, r * 2);

        // --- UPDATED CANADA SKIN (EXACT FLAG) ---
      } else if (pl.country === "canada") {
        // 1:2:1 Proportions
        // Total width = 2r.
        // Side bars = 1/4 of total width each = 0.5r. Center = 0.5 width = r.
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(-r, -r, r * 2, r * 2); // White background
        ctx.fillStyle = "#FF0000";
        ctx.fillRect(-r, -r, r * 0.5, r * 2); // Left Red
        ctx.fillStyle = "#FF0000";
        ctx.fillRect(r * 0.5, -r, r * 0.5, r * 2); // Right Red

        // Detailed 11-point Maple Leaf
        ctx.fillStyle = "#FF0000";
        ctx.beginPath();
        // Move to top center tip
        ctx.moveTo(0, -r * 0.45);
        // Top Right lobe
        ctx.lineTo(r * 0.1, -r * 0.25);
        ctx.lineTo(r * 0.2, -r * 0.35);
        ctx.lineTo(r * 0.22, -r * 0.15);
        // Bottom Right lobe
        ctx.lineTo(r * 0.35, -r * 0.1);
        ctx.lineTo(r * 0.25, 0.05);
        ctx.lineTo(r * 0.25, 0.25);
        // Stem right side
        ctx.lineTo(r * 0.05, 0.25);
        ctx.lineTo(r * 0.05, 0.45);
        // Stem left side
        ctx.lineTo(-r * 0.05, 0.45);
        ctx.lineTo(-r * 0.05, 0.25);
        // Bottom Left lobe
        ctx.lineTo(-r * 0.25, 0.25);
        ctx.lineTo(-r * 0.25, 0.05);
        ctx.lineTo(-r * 0.35, -r * 0.1);
        // Top Left lobe
        ctx.lineTo(-r * 0.22, -r * 0.15);
        ctx.lineTo(-r * 0.2, -r * 0.35);
        ctx.lineTo(-r * 0.1, -r * 0.25);
        ctx.closePath();
        ctx.fill();
      } else if (pl.country === "ukraine") {
        ctx.fillStyle = "#0057B8";
        ctx.fillRect(-r, -r, r * 2, r);
        ctx.fillStyle = "#FFD700";
        ctx.fillRect(-r, 0, r * 2, r);

        // --- UPDATED SOVIET SKIN (EXACT FLAG) ---
      } else if (pl.country === "soviet") {
        // Red Background
        ctx.fillStyle = "#CC0000";
        ctx.fillRect(-r, -r, r * 2, r * 2);

        // Gold Star (Centered above Hammer & Sickle)
        ctx.fillStyle = "#FFD700";
        ctx.beginPath();
        const sx = 0,
          sy = -r * 0.35;
        const outer = r * 0.12,
          inner = r * 0.05;
        let rot = (Math.PI / 2) * 3;
        const step = Math.PI / 5;
        ctx.moveTo(sx, sy - outer);
        for (let i = 0; i < 5; i++) {
          ctx.lineTo(sx + Math.cos(rot) * outer, sy + Math.sin(rot) * outer);
          rot += step;
          ctx.lineTo(sx + Math.cos(rot) * inner, sy + Math.sin(rot) * inner);
          rot += step;
        }
        ctx.closePath();
        ctx.fill();

        // Hammer and Sickle
        ctx.strokeStyle = "#FFD700";
        ctx.lineWidth = r * 0.08;
        ctx.lineCap = "butt";

        // Sickle (Arc)
        ctx.beginPath();
        ctx.arc(-r * 0.05, r * 0.1, r * 0.25, 0.8 * Math.PI, 2.2 * Math.PI);
        ctx.stroke();
        // Sickle Handle
        ctx.beginPath();
        ctx.moveTo(-r * 0.05, r * 0.35);
        ctx.lineTo(-r * 0.05, r * 0.5);
        ctx.stroke();

        // Hammer
        ctx.save();
        ctx.translate(r * 0.05, r * 0.1);
        ctx.rotate(-Math.PI / 4);
        ctx.fillStyle = "#FFD700";
        ctx.fillRect(-r * 0.04, -r * 0.3, r * 0.08, r * 0.5); // Handle
        ctx.fillRect(-r * 0.12, -r * 0.3, r * 0.24, r * 0.08); // Head
        ctx.restore();

        // --- UPDATED GOLDEN MAPLE SKIN (SHINY) ---
      } else if (pl.country === "golden_maple") {
        // Golden Shine Gradient Background
        const grad = ctx.createLinearGradient(-r, -r, r, r);
        grad.addColorStop(0, "#FFD700");
        grad.addColorStop(0.5, "#F0E68C");
        grad.addColorStop(1, "#DAA520");
        ctx.fillStyle = grad;
        ctx.fillRect(-r, -r, r * 2, r * 2);

        // Darker Gold Side Bars (1:2:1)
        const barColor = "rgba(184, 134, 11, 0.9)";
        ctx.fillStyle = barColor;
        ctx.fillRect(-r, -r, r * 0.5, r * 2);
        ctx.fillRect(r * 0.5, -r, r * 0.5, r * 2);

        // Shiny Metallic Leaf (Using Canada Path)
        // Create metallic gradient for leaf
        const leafGrad = ctx.createLinearGradient(0, -r, 0, r);
        leafGrad.addColorStop(0, "#B8860B");
        leafGrad.addColorStop(0.5, "#DAA520");
        leafGrad.addColorStop(1, "#8B4513");
        ctx.fillStyle = leafGrad;

        ctx.beginPath();
        ctx.moveTo(0, -r * 0.45);
        ctx.lineTo(r * 0.1, -r * 0.25);
        ctx.lineTo(r * 0.2, -r * 0.35);
        ctx.lineTo(r * 0.22, -r * 0.15);
        ctx.lineTo(r * 0.35, -r * 0.1);
        ctx.lineTo(r * 0.25, 0.05);
        ctx.lineTo(r * 0.25, 0.25);
        ctx.lineTo(r * 0.05, 0.25);
        ctx.lineTo(r * 0.05, 0.45);
        ctx.lineTo(-r * 0.05, 0.45);
        ctx.lineTo(-r * 0.05, 0.25);
        ctx.lineTo(-r * 0.25, 0.25);
        ctx.lineTo(-r * 0.25, 0.05);
        ctx.lineTo(-r * 0.35, -r * 0.1);
        ctx.lineTo(-r * 0.22, -r * 0.15);
        ctx.lineTo(-r * 0.2, -r * 0.35);
        ctx.lineTo(-r * 0.1, -r * 0.25);
        ctx.closePath();
        ctx.fill();

        // Add a "shine" circle
        ctx.save();
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = "white";
        ctx.beginPath();
        ctx.arc(-r * 0.2, -r * 0.2, r * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
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

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

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

    if (isSpectating) {
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(0, canvas.height / dpr - 40, canvas.width / dpr, 40);
      ctx.fillStyle = "white";
      ctx.font = "20px Arial";
      ctx.textAlign = "center";
      ctx.fillText(
        `SPECTATING: ${me.name || "Unknown"}`,
        canvas.width / dpr / 2,
        canvas.height / dpr - 12
      );
    }

    if (
      !me.dead &&
      ["soviet", "golden_maple"].includes(me.country) &&
      !isSpectating
    ) {
      const cooldown = 60000;
      const timeSince = Date.now() - (me.lastAbilityTime || 0);
      const isActive = me.barrageActive || !!me.maplePhase;
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
      ctx.arc(
        cx,
        cy,
        radius - 5,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * progress
      );
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
      // UPDATED: CLICK TO RESPAWN VISUAL
      ctx.font = "20px Arial";
      ctx.fillText(
        "Press R or Click to Restart",
        canvas.width / dpr / 2,
        canvas.height / dpr / 2
      );
      ctx.beginPath();
      ctx.rect(
        canvas.width / dpr / 2 - 100,
        canvas.height / dpr / 2 + 20,
        200,
        50
      );
      ctx.strokeStyle = "white";
      ctx.stroke();
      ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
      ctx.fill();
      ctx.fillStyle = "#FECB00";
      ctx.fillText(
        "RESPAWN",
        canvas.width / dpr / 2,
        canvas.height / dpr / 2 + 52
      );
    }
  }

  // --- STYLES ---
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
    chatContainer: {
      position: "absolute",
      bottom: "10px",
      left: "10px",
      width: "300px",
      height: "200px",
      display: "flex",
      flexDirection: "column",
      pointerEvents: "auto",
      zIndex: 999,
    },
    chatMessages: {
      flex: 1,
      overflowY: "hidden",
      display: "flex",
      flexDirection: "column",
      justifyContent: "flex-end",
      textShadow: "1px 1px 2px black",
      marginBottom: "5px",
    },
    chatLine: {
      fontSize: "14px",
      marginBottom: "2px",
      background: "rgba(0,0,0,0.3)",
      padding: "2px 5px",
      borderRadius: "4px",
    },
    chatInput: {
      background: "rgba(0,0,0,0.5)",
      border: "1px solid #555",
      color: "white",
      padding: "8px",
      borderRadius: "4px",
      outline: "none",
    },
    spectateRow: {
      padding: "10px",
      background: "#222",
      marginBottom: "5px",
      borderRadius: "5px",
      cursor: "pointer",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
    },
  };

  const currentSkins = skinCategory === "normal" ? SKINS_NORMAL : SKINS_SPECIAL;

  return (
    <div style={styles.wrapper}>
      <div
        style={{
          position: "absolute",
          top: "20px",
          width: "100%",
          textAlign: "center",
          color: "white",
          fontSize: "30px",
          fontWeight: "bold",
          zIndex: 100,
          textShadow: "0px 0px 5px black",
          pointerEvents: "none",
        }}
      >
        {menuState === "playing" ? (isSpectating ? "SPECTATOR MODE" : "") : ""}
      </div>

      {menuState === "playing" && (
        <div style={styles.chatContainer}>
          <div style={styles.chatMessages}>
            {chatMessages.map((msg, i) => (
              <div key={i} style={styles.chatLine}>
                <span style={{ color: msg.color, fontWeight: "bold" }}>
                  {msg.name}:{" "}
                </span>
                <span>{msg.text}</span>
              </div>
            ))}
          </div>
          <form onSubmit={handleSendChat}>
            <input
              style={styles.chatInput}
              placeholder="Type to chat..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
            />
          </form>
        </div>
      )}

      <canvas ref={canvasRef} style={{ display: "block" }} />

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

            <div
              style={{
                marginTop: "20px",
                borderTop: "1px solid #333",
                paddingTop: "15px",
              }}
            >
              <div
                style={{
                  color: "#FECB00",
                  fontWeight: "bold",
                  marginBottom: "10px",
                  fontSize: "14px",
                }}
              >
                LIVE GAMES (Click to Spectate){" "}
                {isScanning && (
                  <span style={{ fontSize: "10px", color: "#666" }}>
                    (Scanning...)
                  </span>
                )}
              </div>
              {spectateList.length === 0 ? (
                <div
                  style={{
                    color: "#666",
                    fontSize: "12px",
                    fontStyle: "italic",
                  }}
                >
                  No active single player games found. Start one!
                </div>
              ) : (
                <div style={{ maxHeight: "120px", overflowY: "auto" }}>
                  {spectateList.map((game) => (
                    <div
                      key={game.id}
                      style={styles.spectateRow}
                      onClick={() => initSpectate(game.id)}
                    >
                      <div>
                        <div
                          style={{
                            fontWeight: "bold",
                            fontSize: "13px",
                            color: "white",
                          }}
                        >
                          {game.host || "Unknown Player"}
                        </div>
                        <div style={{ fontSize: "11px", color: "#888" }}>
                          Playing Solo
                        </div>
                      </div>
                      <div
                        style={{
                          background: "#28a745",
                          color: "white",
                          fontSize: "10px",
                          padding: "3px 6px",
                          borderRadius: "3px",
                        }}
                      >
                        WATCH
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
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
