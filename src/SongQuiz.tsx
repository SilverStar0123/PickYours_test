import React, { useState, useEffect, useRef, useMemo } from "react";
import type { Lang, MsgKey } from "./i18n";
import type { Agency } from "./types";
import { loadCsv, stripQuotes } from "./utils";

export interface SongItem {
  id: string;
  unit: string; // 한국어 기준 유닛 id (예: 'Trickstar', '유성대')
  titleKo: string;
  titleEn: string;
  titleJa: string;
  aliases: string[];
  videoId: string;
  startMin: number;
  endMax: number;
}

interface SongQuizProps {
  agencies: Agency[]; // 현재 언어로 로컬라이즈된 소속사/유닛 목록
  lang: Lang;
  t: (key: MsgKey, params?: Record<string, string | number>) => string;
}

// 유튜브 일반 링크, 짧은 링크(youtu.be), 쇼츠, 유튜브 뮤직(music.youtube.com), 혹은 11자리 영상 ID에서 ID 추출
export function extractYouTubeId(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const v = u.searchParams.get("v");
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
    const parts = u.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    if (last && /^[a-zA-Z0-9_-]{11}$/.test(last)) return last;
  } catch {
    /* URL 객체 파싱 실패 시 아래 정규식으로 재시도 */
  }
  const m = s.match(/(?:v=|youtu\.be\/|embed\/|shorts\/|watch\?v=)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

// 초보자 모드용 정규화: 소문자 + 전각→반각(NFKC) + 모든 띄어쓰기 및 특수부호(', !, ☆, *, :, - 등) 제거
export function normalizeEasy(str: string): string {
  return str
    .normalize("NFKC")
    .toLowerCase()
    // 한글, 영문, 숫자, 일본어(히라가나·카타카나·한자)만 남기고 모든 공백/기호 제거
    .replace(/[^a-z0-9가-힣ㄱ-ㅎㅏ-ㅣ\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/g, "");
}

// 일반(정확) 모드용 정규화: 앞뒤 공백 정리 + 연속 공백 1칸으로 + 대소문자 무시 + 아포스트로피 종류만 통일
export function normalizeStrict(str: string): string {
  return str
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// 한 곡에서 인정되는 모든 정답 문자열 목록 (한/영/일 제목 + 별칭 + 초보자 모드일 경우 괄호 부제 제거본 포함)
function getAcceptedAnswers(song: SongItem, includeParenStripped: boolean): string[] {
  const base = [song.titleKo, song.titleEn, song.titleJa, ...song.aliases]
    .map((x) => x.trim())
    .filter(Boolean);
  if (!includeParenStripped) return base;
  const extra: string[] = [];
  base.forEach((title) => {
    const stripped = title.replace(/\s*[\(（\[【].*?[\)）\]】]\s*/g, "").trim();
    if (stripped && stripped.length >= 2 && stripped !== title) {
      extra.push(stripped);
    }
  });
  return Array.from(new Set([...base, ...extra]));
}

export function isCorrectGuess(guess: string, song: SongItem, easyMode: boolean): boolean {
  const raw = guess.trim();
  if (!raw) return false;
  const candidates = getAcceptedAnswers(song, easyMode);
  if (easyMode) {
    const g = normalizeEasy(raw);
    if (!g) return false;
    return candidates.some((c) => normalizeEasy(c) === g);
  } else {
    const g = normalizeStrict(raw);
    if (!g) return false;
    return candidates.some((c) => normalizeStrict(c) === g);
  }
}

// YouTube IFrame API 스크립트를 로드하고 YT.Player 객체를 반환 (콜백 누락 대비 폴링 병행)
let ytApiPromise: Promise<any> | null = null;
function loadYouTubeApi(): Promise<any> {
  if (typeof window !== "undefined" && (window as any).YT && (window as any).YT.Player) {
    return Promise.resolve((window as any).YT);
  }
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    let resolved = false;
    const done = () => {
      if (resolved) return;
      if ((window as any).YT && (window as any).YT.Player) {
        resolved = true;
        resolve((window as any).YT);
      }
    };
    const prev = (window as any).onYouTubeIframeAPIReady;
    (window as any).onYouTubeIframeAPIReady = () => {
      if (typeof prev === "function") prev();
      done();
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      document.head.appendChild(script);
    }
    const timer = window.setInterval(() => {
      if ((window as any).YT && (window as any).YT.Player) {
        window.clearInterval(timer);
        done();
      }
    }, 100);
  });
  return ytApiPromise;
}

export default function SongQuiz({ agencies, lang, t }: SongQuizProps) {
  const [songs, setSongs] = useState<SongItem[]>([]);
  const [loadingCsv, setLoadingCsv] = useState(true);

  // 초보자 모드 (띄어쓰기/특수부호 무시 + 자동완성 보기)
  const [easyMode, setEasyMode] = useState<boolean>(true);

  // 선택된 유닛 필터 (기본: 16개 정규 유닛 + songs.csv에 추가된 특별 카테고리 자동 포함)
  const allUnits = useMemo(() => {
    const base = agencies.flatMap((a) => a.groups.map((g) => ({ id: g.id, name: g.name })));
    const seen = new Set(base.map((u) => u.id));
    songs.forEach((s) => {
      if (s.unit && !seen.has(s.unit)) {
        seen.add(s.unit);
        base.push({ id: s.unit, name: s.unit });
      }
    });
    return base;
  }, [agencies, songs]);

  const unitNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    allUnits.forEach((g) => {
      m[g.id] = g.name;
    });
    return m;
  }, [allUnits]);

  const [selectedUnits, setSelectedUnits] = useState<Set<string>>(() => new Set());
  const knownUnitsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (allUnits.length === 0) return;
    const added: string[] = [];
    allUnits.forEach((u) => {
      if (!knownUnitsRef.current.has(u.id)) {
        knownUnitsRef.current.add(u.id);
        added.push(u.id);
      }
    });
    if (added.length > 0) {
      setSelectedUnits((prev) => {
        const next = new Set(Array.from(prev));
        added.forEach((id) => next.add(id));
        return next;
      });
    }
  }, [allUnits]);

  // 현재 문제 상태
  const [currentSong, setCurrentSong] = useState<SongItem | null>(null);
  const currentSongRef = useRef<SongItem | null>(null);
  currentSongRef.current = currentSong;

  const [clipDuration, setClipDuration] = useState<number>(1); // 1초 → 2초 → 3초
  const [startSec, setStartSec] = useState<number>(20);
  const [tries, setTries] = useState<number>(0);
  const [status, setStatus] = useState<"playing" | "correct" | "giveup">("playing");
  const [wrongShake, setWrongShake] = useState(false);
  const [showUnitHint, setShowUnitHint] = useState(false);
  const [guess, setGuess] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  // 점수 기록
  const [streak, setStreak] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [totalPlayed, setTotalPlayed] = useState(0);

  // 플레이어 상태
  const playerRef = useRef<any>(null);
  const playerReadyRef = useRef(false);
  const playerHostRef = useRef<HTMLDivElement>(null);
  const quizCardRef = useRef<HTMLDivElement>(null);
  const stopTimerRef = useRef<number | null>(null);
  const loadWatchdogRef = useRef<number | null>(null);
  const pendingPlayRef = useRef(false);
  const activeVideoIdRef = useRef<string>("");
  const clipDurationRef = useRef(clipDuration);
  clipDurationRef.current = clipDuration;
  const startSecRef = useRef(startSec);
  startSecRef.current = startSec;

  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [playerError, setPlayerError] = useState(false);

  // 직접 링크 입력 테스트용
  const [customUrl, setCustomUrl] = useState("");
  const [customTitle, setCustomTitle] = useState("");

  // songs.csv 불러오기
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await loadCsv("songs.csv");
        if (cancelled) return;
        const parsed: SongItem[] = [];
        rows.forEach((r, idx) => {
          const rawUrl = stripQuotes(r.youtube || r.url || r.video || "");
          const videoId = extractYouTubeId(rawUrl);
          if (!videoId) return;
          const unit = stripQuotes(r.unit || "");
          const titleKo = stripQuotes(r.title_ko || r.title || "");
          const titleEn = stripQuotes(r.title_en || "");
          const titleJa = stripQuotes(r.title_ja || "");
          if (!titleKo && !titleEn && !titleJa) return;
          const aliases = stripQuotes(r.aliases || "")
            .split(/[|,]/)
            .map((s) => s.trim())
            .filter(Boolean);
          const startMin = Math.max(0, Number(stripQuotes(r.start_min || "")) || 15);
          const endMax = Math.max(0, Number(stripQuotes(r.end_max || "")) || 0);
          parsed.push({
            id: `song-${idx}-${videoId}`,
            unit: unit || "기타",
            titleKo: titleKo || titleEn || titleJa,
            titleEn: titleEn || titleKo || titleJa,
            titleJa: titleJa || titleEn || titleKo,
            aliases,
            videoId,
            startMin,
            endMax
          });
        });
        setSongs(parsed);
      } catch (err) {
        console.warn("songs.csv 로드 실패:", err);
      } finally {
        if (!cancelled) setLoadingCsv(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 유닛별 곡 수 집계
  const songCountByUnit = useMemo(() => {
    const counts: Record<string, number> = {};
    songs.forEach((s) => {
      counts[s.unit] = (counts[s.unit] || 0) + 1;
    });
    return counts;
  }, [songs]);

  // 현재 선택된 유닛에 해당하는 곡 목록
  const filteredSongs = useMemo(
    () => songs.filter((s) => selectedUnits.has(s.unit)),
    [songs, selectedUnits]
  );

  // 무작위 시작 위치(초) 뽑기
  const pickRandomStart = (song: SongItem, durationSec?: number) => {
    const minS = song.startMin || 15;
    const maxS =
      song.endMax > minS + 5
        ? song.endMax
        : durationSec && durationSec > minS + 20
        ? Math.floor(durationSec - 15)
        : 95;
    return minS + Math.floor(Math.random() * Math.max(1, maxS - minS));
  };

  const clearTimers = () => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    if (loadWatchdogRef.current !== null) {
      window.clearTimeout(loadWatchdogRef.current);
      loadWatchdogRef.current = null;
    }
  };

  const stopPlayerSafely = () => {
    clearTimers();
    pendingPlayRef.current = false;
    setIsPlayingAudio(false);
    setLoadingAudio(false);
    try {
      playerRef.current?.pauseVideo?.();
    } catch {
      /* ignore */
    }
  };

  // 언마운트 시 플레이어 정리
  useEffect(() => {
    return () => {
      clearTimers();
      try {
        playerRef.current?.destroy?.();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
      playerReadyRef.current = false;
    };
  }, []);

  // 플레이어를 생성하거나(첫 실행 시 반드시 유효한 videoId와 함께 생성!) 이미 생성되어 있으면 해당 영상을 재생
  const ensurePlayerAndPlay = async (videoId: string, targetStart: number, durSec: number) => {
    clearTimers();
    setPlayerError(false);
    clipDurationRef.current = durSec;
    startSecRef.current = targetStart;
    pendingPlayRef.current = true;
    setLoadingAudio(true);

    // 6초 안에 재생이 시작되지 않으면 '음원 준비 중...' 잠금을 자동으로 풀어 먹통 방지
    loadWatchdogRef.current = window.setTimeout(() => {
      setLoadingAudio(false);
    }, 6000);

    const YT = await loadYouTubeApi();
    if (!playerHostRef.current) {
      setLoadingAudio(false);
      return;
    }

    // 이미 플레이어가 준비되어 있으면 바로 loadVideoById 또는 seekTo로 재생
    if (playerRef.current && playerReadyRef.current) {
      try {
        if (activeVideoIdRef.current !== videoId) {
          activeVideoIdRef.current = videoId;
          playerRef.current.loadVideoById({
            videoId,
            startSeconds: targetStart
          });
        } else {
          playerRef.current.seekTo(targetStart, true);
          playerRef.current.playVideo();
        }
        return;
      } catch {
        // 기존 플레이어 호출 실패 시 아래에서 새로 생성
        try {
          playerRef.current.destroy?.();
        } catch {
          /* ignore */
        }
        playerRef.current = null;
        playerReadyRef.current = false;
      }
    }

    // 플레이어를 유효한 videoId와 함께 새로 생성 (빈 videoId로 생성하면 onReady가 안 불리므로 반드시 videoId 전달!)
    const el = document.createElement("div");
    playerHostRef.current.innerHTML = "";
    playerHostRef.current.appendChild(el);
    activeVideoIdRef.current = videoId;

    playerRef.current = new YT.Player(el, {
      width: "280",
      height: "158",
      videoId,
      playerVars: {
        autoplay: 1,
        playsinline: 1,
        controls: 1,
        rel: 0,
        start: Math.floor(targetStart)
      },
      events: {
        onReady: (event: any) => {
          playerReadyRef.current = true;
          if (pendingPlayRef.current) {
            try {
              event.target.seekTo(startSecRef.current, true);
              event.target.playVideo();
            } catch {
              /* ignore */
            }
          }
        },
        onStateChange: (event: any) => {
          // YT.PlayerState.PLAYING === 1
          if (event.data === 1) {
            if (loadWatchdogRef.current !== null) {
              window.clearTimeout(loadWatchdogRef.current);
              loadWatchdogRef.current = null;
            }
            setLoadingAudio(false);
            setIsPlayingAudio(true);
            setPlayerError(false);

            // 커스텀 링크 테스트 시 정답 제목을 안 적었다면 유튜브 실제 영상 제목으로 자동 채움
            try {
              const fetchedTitle = event.target?.getVideoData?.()?.title;
              if (
                fetchedTitle &&
                currentSongRef.current &&
                currentSongRef.current.id.startsWith("custom-") &&
                currentSongRef.current.titleKo === "유튜브 테스트 곡"
              ) {
                setCurrentSong((prev) =>
                  prev
                    ? {
                        ...prev,
                        titleKo: fetchedTitle,
                        titleEn: fetchedTitle,
                        titleJa: fetchedTitle
                      }
                    : prev
                );
              }
            } catch {
              /* ignore */
            }

            // 지정된 초(1초/2초/3초) 뒤에 자동 일시정지
            if (pendingPlayRef.current) {
              if (stopTimerRef.current !== null) {
                window.clearTimeout(stopTimerRef.current);
              }
              stopTimerRef.current = window.setTimeout(() => {
                try {
                  event.target?.pauseVideo?.();
                } catch {
                  /* ignore */
                }
                pendingPlayRef.current = false;
                setIsPlayingAudio(false);
              }, clipDurationRef.current * 1000);
            }
          } else if (event.data === 3) {
            // BUFFERING(3): 버퍼링 중에는 1초 타이머를 멈추고 실제 소리가 날 때(1)부터 1초를 잼
            if (stopTimerRef.current !== null) {
              window.clearTimeout(stopTimerRef.current);
              stopTimerRef.current = null;
            }
          } else if (event.data === 5) {
            // video cued(5): 재생 대기 상태가 되면 즉시 재생 시작
            if (pendingPlayRef.current) {
              try {
                event.target?.seekTo?.(startSecRef.current, true);
                event.target?.playVideo?.();
              } catch {
                /* ignore */
              }
            }
          } else if (event.data === 2 || event.data === 0) {
            // PAUSED(2) or ENDED(0)
            if (!pendingPlayRef.current) {
              setIsPlayingAudio(false);
              setLoadingAudio(false);
            }
          }
        },
        onError: () => {
          clearTimers();
          pendingPlayRef.current = false;
          setIsPlayingAudio(false);
          setLoadingAudio(false);
          setPlayerError(true);
        }
      }
    });
  };

  // 새 문제 출제
  const startNewQuestion = (pool: SongItem[], avoidId?: string) => {
    stopPlayerSafely();
    setPlayerError(false);

    if (pool.length === 0) {
      setCurrentSong(null);
      return;
    }
    const candidates = pool.length > 1 && avoidId ? pool.filter((s) => s.id !== avoidId) : pool;
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    const initialStart = pickRandomStart(chosen);

    currentSongRef.current = chosen;
    setCurrentSong(chosen);
    setClipDuration(1);
    setStartSec(initialStart);
    setTries(0);
    setStatus("playing");
    setShowUnitHint(false);
    setGuess("");
    setShowSuggestions(false);
  };

  // 필터된 곡 목록이 준비되면 첫 문제 자동 설정 (단, 직접 입력한 Custom 문제를 풀고 있을 때는 덮어쓰지 않음)
  useEffect(() => {
    if (loadingCsv) return;
    if (currentSongRef.current?.id.startsWith("custom-")) return;
    if (filteredSongs.length === 0) {
      setCurrentSong(null);
      return;
    }
    if (!currentSongRef.current || !filteredSongs.some((s) => s.id === currentSongRef.current?.id)) {
      startNewQuestion(filteredSongs);
    }
  }, [loadingCsv, filteredSongs]);

  // 1초(또는 연장된 초) 재생 실행
  const playSnippet = (overrideSec?: number, overrideStart?: number, overrideSong?: SongItem) => {
    const targetSong = overrideSong ?? currentSong;
    if (!targetSong) return;

    const dur = overrideSec ?? clipDuration;
    let targetStart = overrideStart ?? startSec;

    try {
      if (
        playerRef.current &&
        playerReadyRef.current &&
        overrideStart === undefined &&
        activeVideoIdRef.current === targetSong.videoId
      ) {
        const totalDur = Number(playerRef.current.getDuration?.() || 0);
        if (totalDur > 40 && targetStart >= totalDur - 10) {
          targetStart = pickRandomStart(targetSong, totalDur);
          setStartSec(targetStart);
        }
      }
    } catch {
      /* ignore */
    }

    ensurePlayerAndPlay(targetSong.videoId, targetStart, dur);
  };

  // +1초 늘리기 (최대 5초)
  const extendDuration = () => {
    const next = Math.min(5, clipDuration + 1);
    setClipDuration(next);
    playSnippet(next, startSec);
  };

  // 다른 1초 구간 뽑기
  const rerollSpot = () => {
    if (!currentSong) return;
    const totalDur =
      playerRef.current && playerReadyRef.current && activeVideoIdRef.current === currentSong.videoId
        ? Number(playerRef.current?.getDuration?.() || 0)
        : 0;
    const nextStart = pickRandomStart(currentSong, totalDur > 0 ? totalDur : undefined);
    setStartSec(nextStart);
    playSnippet(clipDuration, nextStart);
  };

  // 정답 제출
  const handleGuessSubmit = (overrideGuess?: string) => {
    if (!currentSong || status !== "playing") return;
    const value = (overrideGuess ?? guess).trim();
    if (!value) return;

    const nextTries = tries + 1;
    setTries(nextTries);
    setShowSuggestions(false);

    if (isCorrectGuess(value, currentSong, easyMode)) {
      clearTimers();
      pendingPlayRef.current = false;
      setIsPlayingAudio(false);
      setLoadingAudio(false);
      setStatus("correct");
      setStreak((s) => s + 1);
      setCorrectCount((c) => c + 1);
      setTotalPlayed((p) => p + 1);
    } else {
      setWrongShake(true);
      window.setTimeout(() => setWrongShake(false), 400);
    }
  };

  // 포기 / 정답 보기
  const handleGiveUp = () => {
    if (!currentSong || status !== "playing") return;
    clearTimers();
    pendingPlayRef.current = false;
    setIsPlayingAudio(false);
    setLoadingAudio(false);
    setStatus("giveup");
    setStreak(0);
    setTotalPlayed((p) => p + 1);
  };

  // 초보자 모드용 자동완성 후보 목록 (선택된 유닛의 곡들 중에서 검색)
  const suggestions = useMemo(() => {
    if (!easyMode || status !== "playing") return [];
    const q = normalizeEasy(guess);
    if (!q) return [];
    const pool = filteredSongs.length > 0 ? filteredSongs : songs;
    return pool
      .filter((s) => {
        const all = getAcceptedAnswers(s, true);
        return all.some((ans) => normalizeEasy(ans).includes(q));
      })
      .slice(0, 7);
  }, [easyMode, status, guess, filteredSongs, songs]);

  // 현재 언어에 맞는 대표 곡 제목 표시
  const formatSongDisplay = (s: SongItem): string => {
    const primary =
      lang === "ja"
        ? s.titleJa || s.titleEn || s.titleKo
        : lang === "en"
        ? s.titleEn || s.titleKo || s.titleJa
        : s.titleKo || s.titleEn || s.titleJa;
    const others = Array.from(new Set([s.titleKo, s.titleEn, s.titleJa])).filter(
      (x) => x && x !== primary
    );
    return others.length > 0 ? `${primary} (${others.join(" / ")})` : primary;
  };

  // 유닛 토글
  const toggleUnit = (unitId: string) => {
    setSelectedUnits((prev) => {
      const next = new Set(Array.from(prev));
      if (next.has(unitId)) next.delete(unitId);
      else next.add(unitId);
      return next;
    });
  };

  // 커스텀 유튜브 링크로 즉시 테스트 문제 만들고 1초 재생 시작
  const handleCustomUrlStart = () => {
    const vid = extractYouTubeId(customUrl);
    if (!vid) {
      alert("올바른 유튜브 또는 유튜브 뮤직 링크를 입력해주세요.");
      return;
    }
    const title = customTitle.trim() || "유튜브 테스트 곡";
    const customSong: SongItem = {
      id: `custom-${Date.now()}`,
      unit: "직접 입력 테스트",
      titleKo: title,
      titleEn: title,
      titleJa: title,
      aliases: [],
      videoId: vid,
      startMin: 15,
      endMax: 90
    };
    const start = pickRandomStart(customSong);
    currentSongRef.current = customSong;
    setCurrentSong(customSong);
    setClipDuration(1);
    setStartSec(start);
    setTries(0);
    setStatus("playing");
    setShowUnitHint(false);
    setGuess("");
    setPlayerError(false);

    quizCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    ensurePlayerAndPlay(vid, start, 1);
  };

  const revealed = status === "correct" || status === "giveup";

  return (
    <div className="quiz-container">
      <h1>{t("quizTitle")}</h1>
      <p className="subtitle">{t("quizSubtitle")}</p>

      {/* 초보자 모드 스위치 + 점수판 */}
      <div className="quiz-top-bar">
        <label className="switch">
          <input
            type="checkbox"
            role="switch"
            checked={easyMode}
            onChange={(e) => setEasyMode(e.target.checked)}
          />
          <span className="switch-track" aria-hidden="true">
            <span className="switch-thumb" />
          </span>
          <span>{t("quizEasyMode")}</span>
        </label>
        <div className="quiz-score-badges">
          <span className="quiz-badge streak">{t("quizScoreStreak", { streak })}</span>
          <span className="quiz-badge">{t("quizScoreTotal", { correct: correctCount, total: totalPlayed })}</span>
        </div>
      </div>
      <p className="hint" style={{ marginTop: "-4px", marginBottom: "14px" }}>
        {easyMode ? t("quizEasyHint") : t("quizHardHint")}
      </p>

      {/* 특정 유닛 선택 필터 */}
      <details className="quiz-unit-filter">
        <summary>
          {t("quizUnitFilterTitle", {
            selected: selectedUnits.size,
            total: allUnits.length,
            songs: filteredSongs.length
          })}
        </summary>
        <div className="quiz-unit-actions">
          <button
            type="button"
            className="ghost-sm"
            onClick={() => setSelectedUnits(new Set(allUnits.map((u) => u.id)))}
          >
            {t("quizSelectAllUnits")}
          </button>
          <button type="button" className="ghost-sm" onClick={() => setSelectedUnits(new Set())}>
            {t("quizClearUnits")}
          </button>
        </div>
        <div className="quiz-unit-chips">
          {allUnits.map((u) => {
            const active = selectedUnits.has(u.id);
            const cnt = songCountByUnit[u.id] || 0;
            return (
              <button
                key={u.id}
                type="button"
                className={`quiz-unit-chip${active ? " active" : ""}`}
                aria-pressed={active}
                onClick={() => toggleUnit(u.id)}
              >
                {u.name} <span className="chip-count">({cnt})</span>
              </button>
            );
          })}
        </div>
      </details>

      {/* 메인 문제 카드 */}
      <div className="quiz-card" ref={quizCardRef}>
        {!currentSong ? (
          <p className="hint">{t("quizNoSongsInFilter")}</p>
        ) : (
          <>
            {currentSong.id.startsWith("custom-") && (
              <p className="quiz-hint-banner" style={{ marginBottom: "12px" }}>
                🔗 직접 입력한 유튜브 링크로 문제 출제 중
              </p>
            )}

            {/* 오디오 컨트롤 영역 (초기 화면에서 '음원 준비 중...'에 절대 갇히지 않도록 항상 클릭 허용) */}
            <div className="quiz-audio-controls">
              <button
                type="button"
                className="download-btn quiz-play-btn"
                disabled={loadingAudio}
                onClick={() => playSnippet()}
              >
                {loadingAudio
                  ? t("quizLoadingAudio")
                  : isPlayingAudio
                  ? t("quizPlaying")
                  : t("quizPlayClip", { sec: clipDuration })}
              </button>

              {status === "playing" && (
                <div className="quiz-helper-btns">
                  {clipDuration < 5 && (
                    <button type="button" className="quiz-sub-btn" onClick={extendDuration}>
                      {t("quizExtendSec", { sec: clipDuration + 1 })}
                    </button>
                  )}
                  <button type="button" className="quiz-sub-btn" onClick={rerollSpot}>
                    {t("quizChangeSpot")}
                  </button>
                  {!showUnitHint && (
                    <button type="button" className="quiz-sub-btn" onClick={() => setShowUnitHint(true)}>
                      {t("quizShowUnitHint")}
                    </button>
                  )}
                </div>
              )}
            </div>

            {showUnitHint && status === "playing" && (
              <p className="quiz-hint-banner">
                {t("quizUnitHintText", { unit: unitNameMap[currentSong.unit] || currentSong.unit })}
              </p>
            )}

            {playerError && <p className="hint busy-note">{t("quizPlayerError")}</p>}

            {/* 정답 입력 영역 */}
            {status === "playing" && (
              <div className="quiz-input-wrap">
                <div className={`quiz-input-row${wrongShake ? " shake" : ""}`}>
                  <input
                    type="text"
                    value={guess}
                    onChange={(e) => {
                      setGuess(e.target.value);
                      setShowSuggestions(true);
                    }}
                    onFocus={() => setShowSuggestions(true)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        handleGuessSubmit();
                      }
                    }}
                    placeholder={t("quizInputPlaceholder")}
                  />
                  <button type="button" className="download-btn" onClick={() => handleGuessSubmit()}>
                    {t("quizSubmitBtn")}
                  </button>
                </div>

                {/* 초보자 모드 자동완성 후보 */}
                {easyMode && showSuggestions && suggestions.length > 0 && (
                  <ul className="quiz-suggestions">
                    {suggestions.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => {
                            const chosenTitle =
                              lang === "ja"
                                ? s.titleJa
                                : lang === "en"
                                ? s.titleEn
                                : s.titleKo;
                            setGuess(chosenTitle);
                            handleGuessSubmit(chosenTitle);
                          }}
                        >
                          <span className="sug-unit">{unitNameMap[s.unit] || s.unit}</span>
                          <span className="sug-title">{formatSongDisplay(s)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {tries > 0 && <p className="quiz-wrong-msg">{t("quizWrongMsg", { tries })}</p>}

                <div style={{ marginTop: "12px" }}>
                  <button
                    type="button"
                    className="quiz-sub-btn giveup"
                    onClick={handleGiveUp}
                  >
                    {t("quizGiveUpBtn")}
                  </button>
                </div>
              </div>
            )}

            {/* 정답 공개 / 포기 후 결과 영역 */}
            {revealed && (
              <div className={`quiz-result-box ${status}`}>
                <h3>
                  {status === "correct"
                    ? t("quizCorrectMsg", { tries })
                    : t("quizGiveUpMsg")}
                </h3>
                <p className="quiz-answer-meta">
                  <b>{t("quizAnswerUnit")}:</b> {unitNameMap[currentSong.unit] || currentSong.unit}
                </p>
                <p className="quiz-answer-meta">
                  <b>{t("quizAnswerTitles")}:</b>{" "}
                  {Array.from(
                    new Set([currentSong.titleKo, currentSong.titleEn, currentSong.titleJa].filter(Boolean))
                  ).join(" / ")}
                </p>
                <button
                  type="button"
                  className="download-btn"
                  style={{ backgroundColor: "#20c997", marginTop: "10px" }}
                  onClick={() => startNewQuestion(filteredSongs, currentSong.id)}
                >
                  {t("quizNextBtn")}
                </button>
              </div>
            )}
          </>
        )}

        {/* 유튜브 플레이어 호스트: 화면 안에 정상 크기로 두되 문제 풀이 중에는 가림막으로 덮어 브라우저 차단 방지 */}
        <div className={revealed ? "quiz-player-visible" : "quiz-player-hidden"}>
          <div ref={playerHostRef} />
        </div>
      </div>

      {/* 직접 유튜브 링크를 넣어 테스트해볼 수 있는 패널 */}
      <details className="quiz-custom-url" open>
        <summary>{t("quizCustomUrlToggle")}</summary>
        <div className="quiz-custom-form">
          <input
            type="text"
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handleCustomUrlStart();
              }
            }}
            placeholder={t("quizCustomUrlPlaceholder")}
          />
          <input
            type="text"
            value={customTitle}
            onChange={(e) => setCustomTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handleCustomUrlStart();
              }
            }}
            placeholder={t("quizCustomTitlePlaceholder")}
          />
          <button
            type="button"
            className="download-btn"
            style={{ padding: "8px 14px", fontSize: "0.85rem" }}
            onClick={handleCustomUrlStart}
          >
            {t("quizCustomStartBtn")}
          </button>
        </div>
      </details>
    </div>
  );
}
