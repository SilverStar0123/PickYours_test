import React, { useState, useEffect, useRef, useMemo } from "react";
import type { Lang, MsgKey } from "./i18n";
import type { Agency } from "./types";
import { loadCsv, stripQuotes } from "./utils";

export const SHUFFLE_UNIT_ID = "__shuffle__";

export interface SongItem {
  id: string;
  unit: string; // 필터 기준 유닛 id (셔플 유닛 곡들은 모두 '__shuffle__'로 통합)
  rawUnit: string; // songs.csv에 적힌 원래 유닛명 (예: 'Ring.A.Bell', 'MODE/D')
  titleKo: string;
  titleEn: string;
  titleJa: string;
  aliases: string[];
  videoId: string;
  startMin: number;
  endMax: number;
}

interface HistoryItem {
  song: SongItem;
  correct: boolean;
  tries: number;
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

// 대소문자·띄어쓰기·특수기호(', !, ☆, *, →, :, - 등) 보정 정규화 (초보자 모드 및 하드 모드 공통 사용)
export function normalizeAnswer(str: string): string {
  return str
    .normalize("NFKC")
    .toLowerCase()
    // 한글, 영문, 숫자, 일본어(히라가나·카타카나·한자)만 남기고 모든 공백/특수부호 제거
    .replace(/[^a-z0-9가-힣ㄱ-ㅎㅏ-ㅣ\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/g, "");
}

// 한 곡에서 인정되는 모든 정답 문자열 목록 (비어있는 언어 칸은 자동 제외 + 괄호 부제 제거본 포함)
function getAcceptedAnswers(song: SongItem): string[] {
  const base = [song.titleKo, song.titleEn, song.titleJa, ...song.aliases]
    .map((x) => x.trim())
    .filter(Boolean);
  const extra: string[] = [];
  base.forEach((title) => {
    const stripped = title.replace(/\s*[\(（\[【].*?[\)）\]】]\s*/g, "").trim();
    if (stripped && stripped.length >= 2 && stripped !== title) {
      extra.push(stripped);
    }
  });
  return Array.from(new Set([...base, ...extra]));
}

export function isCorrectGuess(guess: string, song: SongItem): boolean {
  const g = normalizeAnswer(guess);
  if (!g) return false;
  const candidates = getAcceptedAnswers(song);
  return candidates.some((c) => normalizeAnswer(c) === g);
}

// 배열 무작위 섞기 (Fisher-Yates)
function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

// YouTube IFrame API 스크립트를 로드하고 YT.Player 객체를 반환
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

  // 진행 단계: "setup" (설정 화면) | "playing" (문제 풀이) | "summary" (최종 결과/정답률)
  const [phase, setPhase] = useState<"setup" | "playing" | "summary">("setup");

  // 난이도: true = 초보자 모드(자동완성 후보 표시), false = 하드 모드(직접 입력 + 부호/대소문자 보정)
  const [easyMode, setEasyMode] = useState<boolean>(true);

  // 문제 수 설정: 5, 10, 30, 또는 "custom"
  const [countPreset, setCountPreset] = useState<5 | 10 | 30 | "custom">(10);
  const [customCountInput, setCustomCountInput] = useState<string>("15");

  // 선택된 유닛 필터 (16개 정규 유닛 + '셔플곡' + songs.csv 내 추가 카테고리)
  const allUnits = useMemo(() => {
    const base = agencies.flatMap((a) => a.groups.map((g) => ({ id: g.id, name: g.name })));
    const seen = new Set(base.map((u) => u.id));
    // 셔플곡이 1곡이라도 있으면 '셔플곡' 필터 버튼 추가
    if (songs.some((s) => s.unit === SHUFFLE_UNIT_ID)) {
      seen.add(SHUFFLE_UNIT_ID);
      base.push({ id: SHUFFLE_UNIT_ID, name: t("quizShuffleUnit") });
    }
    songs.forEach((s) => {
      if (s.unit && !seen.has(s.unit)) {
        seen.add(s.unit);
        base.push({ id: s.unit, name: s.unit });
      }
    });
    return base;
  }, [agencies, songs, t]);

  const unitNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    allUnits.forEach((g) => {
      m[g.id] = g.name;
    });
    m[SHUFFLE_UNIT_ID] = t("quizShuffleUnit");
    return m;
  }, [allUnits, t]);

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

  // 현재 라운드 출제 큐 및 기록
  const [questionQueue, setQuestionQueue] = useState<SongItem[]>([]);
  const [questionIdx, setQuestionIdx] = useState<number>(0);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // 현재 문제 상태
  const [currentSong, setCurrentSong] = useState<SongItem | null>(null);
  const currentSongRef = useRef<SongItem | null>(null);
  currentSongRef.current = currentSong;

  const [clipDuration, setClipDuration] = useState<number>(1);
  const [startSec, setStartSec] = useState<number>(20);
  const [tries, setTries] = useState<number>(0);
  const [status, setStatus] = useState<"playing" | "correct" | "giveup">("playing");
  const [wrongShake, setWrongShake] = useState(false);
  const [showUnitHint, setShowUnitHint] = useState(false);
  const [guess, setGuess] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

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

  // ES_list.csv (shuffle1, shuffle2, best_shuffle 추출용) + songs.csv 함께 불러오기
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [esRows, songRows] = await Promise.all([
          loadCsv("ES_list.csv").catch(() => [] as Record<string, string>[]),
          loadCsv("songs.csv")
        ]);
        if (cancelled) return;

        // 1) ES_list.csv의 shuffle1, shuffle2, best_shuffle 열에 적힌 모든 셔플 유닛명 수집
        const shuffleNames = new Set<string>();
        esRows.forEach((r) => {
          ["shuffle1", "shuffle2", "best_shuffle", "shffle"].forEach((col) => {
            const val = stripQuotes(r[col] || "");
            if (val) {
              val
                .split(/[|,]/)
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean)
                .forEach((name) => shuffleNames.add(name));
            }
          });
        });

        // 2) songs.csv 파싱 (영어명 등 일부 언어 제목이 비어 있어도 있는 제목으로 자동 보완)
        const parsed: SongItem[] = [];
        songRows.forEach((r, idx) => {
          const rawUrl = stripQuotes(r.youtube || r.url || r.video || "");
          const videoId = extractYouTubeId(rawUrl);
          if (!videoId) return;

          const rawUnit = stripQuotes(r.unit || "") || "기타";
          const isShuffle =
            shuffleNames.has(rawUnit.toLowerCase()) ||
            rawUnit === "셔플곡" ||
            rawUnit === "셔플 유닛" ||
            rawUnit.toLowerCase() === "shuffle";
          const unit = isShuffle ? SHUFFLE_UNIT_ID : rawUnit;

          const tKo = stripQuotes(r.title_ko || r.title || "");
          const tEn = stripQuotes(r.title_en || "");
          const tJa = stripQuotes(r.title_ja || "");
          const fallbackTitle = tKo || tEn || tJa;
          if (!fallbackTitle) return;

          const aliases = stripQuotes(r.aliases || "")
            .split(/[|,]/)
            .map((s) => s.trim())
            .filter(Boolean);
          const startMin = Math.max(0, Number(stripQuotes(r.start_min || "")) || 15);
          const endMax = Math.max(0, Number(stripQuotes(r.end_max || "")) || 0);

          parsed.push({
            id: `song-${idx}-${videoId}`,
            unit,
            rawUnit,
            // 비어 있는 언어 칸은 다른 언어 제목으로 채워 두어 어느 언어 화면에서도 빈칸이 뜨지 않게 함
            titleKo: tKo || fallbackTitle,
            titleEn: tEn || fallbackTitle,
            titleJa: tJa || fallbackTitle,
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

  // 설정된 목표 문제 수 계산
  const targetQuestionCount = useMemo(() => {
    if (countPreset !== "custom") return countPreset;
    const n = parseInt(customCountInput, 10);
    if (Number.isNaN(n) || n < 1) return 1;
    return Math.min(100, n);
  }, [countPreset, customCountInput]);

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

  // 플레이어를 생성하거나(첫 실행 시 유효한 videoId와 함께 생성) 이미 생성되어 있으면 해당 영상을 재생
  const ensurePlayerAndPlay = async (videoId: string, targetStart: number, durSec: number) => {
    clearTimers();
    setPlayerError(false);
    clipDurationRef.current = durSec;
    startSecRef.current = targetStart;
    pendingPlayRef.current = true;
    setLoadingAudio(true);

    loadWatchdogRef.current = window.setTimeout(() => {
      setLoadingAudio(false);
    }, 6000);

    const YT = await loadYouTubeApi();
    if (!playerHostRef.current) {
      setLoadingAudio(false);
      return;
    }

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
        try {
          playerRef.current.destroy?.();
        } catch {
          /* ignore */
        }
        playerRef.current = null;
        playerReadyRef.current = false;
      }
    }

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
          if (event.data === 1) {
            if (loadWatchdogRef.current !== null) {
              window.clearTimeout(loadWatchdogRef.current);
              loadWatchdogRef.current = null;
            }
            setLoadingAudio(false);
            setIsPlayingAudio(true);
            setPlayerError(false);

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
            if (stopTimerRef.current !== null) {
              window.clearTimeout(stopTimerRef.current);
              stopTimerRef.current = null;
            }
          } else if (event.data === 5) {
            if (pendingPlayRef.current) {
              try {
                event.target?.seekTo?.(startSecRef.current, true);
                event.target?.playVideo?.();
              } catch {
                /* ignore */
              }
            }
          } else if (event.data === 2 || event.data === 0) {
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

  // 특정 문제 객체로 화면 상태 세팅
  const loadQuestionItem = (song: SongItem) => {
    stopPlayerSafely();
    setPlayerError(false);
    const initialStart = pickRandomStart(song);
    currentSongRef.current = song;
    setCurrentSong(song);
    setClipDuration(1);
    setStartSec(initialStart);
    setTries(0);
    setStatus("playing");
    setShowUnitHint(false);
    setGuess("");
    setShowSuggestions(false);
  };

  // 설정 화면에서 '퀴즈 시작하기' 클릭 시 문제 큐 생성 및 시작
  const handleStartQuiz = () => {
    if (filteredSongs.length === 0) {
      alert(t("quizNoSongsInFilter"));
      return;
    }
    const count = targetQuestionCount;
    const queue: SongItem[] = [];
    while (queue.length < count) {
      const batch = shuffleArray(filteredSongs);
      // 경계에서 같은 곡이 연속으로 나오지 않게 조정
      if (queue.length > 0 && batch.length > 1 && batch[0].id === queue[queue.length - 1].id) {
        const first = batch.shift()!;
        batch.push(first);
      }
      queue.push(...batch);
    }
    const finalQueue = queue.slice(0, count);
    setQuestionQueue(finalQueue);
    setQuestionIdx(0);
    setHistory([]);
    setPhase("playing");
    loadQuestionItem(finalQueue[0]);
  };

  // 다음 문제로 이동 또는 결과 화면으로 이동
  const handleNextOrFinish = () => {
    const nextIdx = questionIdx + 1;
    if (nextIdx >= questionQueue.length) {
      stopPlayerSafely();
      setPhase("summary");
    } else {
      setQuestionIdx(nextIdx);
      loadQuestionItem(questionQueue[nextIdx]);
    }
  };

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

    if (isCorrectGuess(value, currentSong)) {
      clearTimers();
      pendingPlayRef.current = false;
      setIsPlayingAudio(false);
      setLoadingAudio(false);
      setStatus("correct");
      setHistory((prev) => [...prev, { song: currentSong, correct: true, tries: nextTries }]);
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
    setHistory((prev) => [...prev, { song: currentSong, correct: false, tries }]);
  };

  // 초보자 모드용 자동완성 후보 목록 (선택된 유닛의 곡들 중에서 중복 곡 없이 검색)
  const suggestions = useMemo(() => {
    if (!easyMode || status !== "playing") return [];
    const q = normalizeAnswer(guess);
    if (!q) return [];
    const pool = filteredSongs.length > 0 ? filteredSongs : songs;
    return pool
      .filter((s) => {
        const all = getAcceptedAnswers(s);
        return all.some((ans) => normalizeAnswer(ans).includes(q));
      })
      .slice(0, 7);
  }, [easyMode, status, guess, filteredSongs, songs]);

  // 현재 언어에 맞는 대표 곡 제목 표시 (중복 없는 다른 언어 제목 병기)
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

  // 정답 공개 및 결과 화면에서 유닛 이름 표시 (셔플곡이면 '셔플곡 (Ring.A.Bell)' 형태로 원래 유닛명 병기)
  const formatFullUnitLabel = (s: SongItem): string => {
    const baseLabel = unitNameMap[s.unit] || s.unit;
    if (s.unit === SHUFFLE_UNIT_ID && s.rawUnit && s.rawUnit !== "셔플곡" && s.rawUnit !== "셔플 유닛") {
      return `${baseLabel} (${s.rawUnit})`;
    }
    return baseLabel;
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

  // 커스텀 유튜브 링크로 1문제 즉시 테스트
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
      rawUnit: "직접 입력 테스트",
      titleKo: title,
      titleEn: title,
      titleJa: title,
      aliases: [],
      videoId: vid,
      startMin: 15,
      endMax: 90
    };
    const start = pickRandomStart(customSong);
    setQuestionQueue([customSong]);
    setQuestionIdx(0);
    setHistory([]);
    setPhase("playing");
    currentSongRef.current = customSong;
    setCurrentSong(customSong);
    setClipDuration(1);
    setStartSec(start);
    setTries(0);
    setStatus("playing");
    setShowUnitHint(false);
    setGuess("");
    setPlayerError(false);

    window.setTimeout(() => {
      quizCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      ensurePlayerAndPlay(vid, start, 1);
    }, 50);
  };

  const revealed = phase === "playing" && (status === "correct" || status === "giveup");
  const correctTotal = useMemo(() => history.filter((h) => h.correct).length, [history]);
  const accuracyPercent =
    questionQueue.length > 0 ? Math.round((correctTotal / questionQueue.length) * 100) : 0;

  if (loadingCsv) {
    return <div className="quiz-container notice-page">{t("loadingData")}</div>;
  }

  return (
    <div className="quiz-container">
      <h1>{t("quizTitle")}</h1>
      <p className="subtitle">{t("quizSubtitle")}</p>

      {/* ────────────────── 1. 시작 전 설정 화면 (Setup) ────────────────── */}
      {phase === "setup" && (
        <div className="quiz-card quiz-setup-card">
          {/* (1) 난이도 선택 */}
          <div className="quiz-setup-section">
            <h3 className="quiz-setup-heading">{t("quizSetupModeTitle")}</h3>
            <div className="quiz-option-row">
              <button
                type="button"
                className={`quiz-opt-btn${easyMode ? " active" : ""}`}
                aria-pressed={easyMode}
                onClick={() => setEasyMode(true)}
              >
                {t("quizEasyModeBtn")}
              </button>
              <button
                type="button"
                className={`quiz-opt-btn${!easyMode ? " active" : ""}`}
                aria-pressed={!easyMode}
                onClick={() => setEasyMode(false)}
              >
                {t("quizHardModeBtn")}
              </button>
            </div>
            <p className="quiz-mode-notice">
              {easyMode ? t("quizEasyHint") : t("quizHardHint")}
            </p>
          </div>

          {/* (2) 문제 수 선택 */}
          <div className="quiz-setup-section">
            <h3 className="quiz-setup-heading">{t("quizSetupCountTitle")}</h3>
            <div className="quiz-option-row">
              {([5, 10, 30] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`quiz-opt-btn${countPreset === n ? " active" : ""}`}
                  aria-pressed={countPreset === n}
                  onClick={() => setCountPreset(n)}
                >
                  {t("quizCountPreset", { n })}
                </button>
              ))}
              <button
                type="button"
                className={`quiz-opt-btn${countPreset === "custom" ? " active" : ""}`}
                aria-pressed={countPreset === "custom"}
                onClick={() => setCountPreset("custom")}
              >
                {t("quizCountCustom")}
              </button>
              {countPreset === "custom" && (
                <input
                  type="number"
                  min={1}
                  max={100}
                  className="quiz-custom-count-input"
                  value={customCountInput}
                  onChange={(e) => setCustomCountInput(e.target.value)}
                  placeholder={t("quizCountCustomPlaceholder")}
                />
              )}
            </div>
          </div>

          {/* (3) 출제 유닛 선택 */}
          <div className="quiz-setup-section">
            <div className="quiz-setup-unit-header">
              <h3 className="quiz-setup-heading" style={{ margin: 0 }}>
                {t("quizSetupUnitTitle", {
                  selected: selectedUnits.size,
                  total: allUnits.length,
                  songs: filteredSongs.length
                })}
              </h3>
              <div className="quiz-unit-actions" style={{ margin: 0 }}>
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
            </div>

            <div className="quiz-unit-chips" style={{ marginTop: "10px" }}>
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
          </div>

          {filteredSongs.length === 0 && (
            <p className="hint busy-note" style={{ marginBottom: "12px" }}>
              {t("quizNoSongsInFilter")}
            </p>
          )}

          <button
            type="button"
            className="download-btn quiz-start-main-btn"
            disabled={filteredSongs.length === 0}
            onClick={handleStartQuiz}
          >
            {t("quizStartBtn", { n: targetQuestionCount })}
          </button>
        </div>
      )}

      {/* ────────────────── 2. 문제 풀이 화면 (Playing) ────────────────── */}
      {phase === "playing" && currentSong && (
        <div className="quiz-card" ref={quizCardRef}>
          {/* 상단 진행도 & 설정으로 돌아가기 */}
          <div className="quiz-playing-header">
            <div className="quiz-score-badges">
              <span className="quiz-badge streak">
                {t("quizProgress", { cur: questionIdx + 1, total: questionQueue.length })}
              </span>
              <span className="quiz-badge">
                {t("quizScoreCurrent", { correct: correctTotal, answered: history.length })}
              </span>
            </div>
            <button
              type="button"
              className="ghost-sm"
              onClick={() => {
                stopPlayerSafely();
                setPhase("setup");
              }}
            >
              {t("quizBackToSetup")}
            </button>
          </div>

          <p className="hint" style={{ marginTop: "0", marginBottom: "14px" }}>
            {easyMode ? t("quizEasyHint") : t("quizHardHint")}
          </p>

          {/* 오디오 컨트롤 영역 */}
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
                <b>{t("quizAnswerUnit")}:</b> {formatFullUnitLabel(currentSong)}
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
                onClick={handleNextOrFinish}
              >
                {questionIdx + 1 >= questionQueue.length
                  ? t("quizFinishBtn")
                  : t("quizNextBtn", { next: questionIdx + 2, total: questionQueue.length })}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ────────────────── 3. 최종 결과 및 정답률 화면 (Summary) ────────────────── */}
      {phase === "summary" && (
        <div className="quiz-card quiz-summary-card">
          <h2>{t("quizSummaryTitle")}</h2>
          <div className="quiz-accuracy-box">
            <div className="quiz-accuracy-label">{t("quizSummaryRateLabel")}</div>
            <div className="quiz-accuracy-number">{accuracyPercent}%</div>
            <div className="quiz-accuracy-detail">
              {t("quizSummaryScoreDetail", { total: questionQueue.length, correct: correctTotal })}
            </div>
          </div>

          <h3 className="quiz-setup-heading" style={{ textAlign: "left", marginTop: "20px" }}>
            {t("quizSummaryHistoryTitle")}
          </h3>
          <ul className="quiz-history-list">
            {history.map((item, idx) => (
              <li key={`${item.song.id}-${idx}`} className={item.correct ? "correct" : "giveup"}>
                <span className="hist-num">#{idx + 1}</span>
                <div className="hist-info">
                  <div className="hist-title">{formatSongDisplay(item.song)}</div>
                  <div className="hist-unit">{formatFullUnitLabel(item.song)}</div>
                </div>
                <span className={`hist-badge ${item.correct ? "ok" : "fail"}`}>
                  {item.correct
                    ? t("quizSummaryBadgeCorrect", { tries: item.tries })
                    : t("quizSummaryBadgeGiveup")}
                </span>
              </li>
            ))}
          </ul>

          <div className="finish-buttons" style={{ marginTop: "20px" }}>
            <button
              type="button"
              className="download-btn"
              style={{ backgroundColor: "#20c997" }}
              onClick={handleStartQuiz}
            >
              {t("quizRetrySameBtn")}
            </button>
            <button
              type="button"
              className="download-btn"
              style={{ backgroundColor: "#4dabf7" }}
              onClick={() => setPhase("setup")}
            >
              {t("quizRetrySetupBtn")}
            </button>
          </div>
        </div>
      )}

      {/* 유튜브 플레이어 호스트: 어떤 화면 단계에서든 언마운트되지 않도록 고정 유지 */}
      <div className={revealed ? "quiz-player-visible" : "quiz-player-hidden"}>
        <div ref={playerHostRef} />
      </div>

      {/* 직접 유튜브 링크를 넣어 1문제 테스트해볼 수 있는 패널 */}
      <details className="quiz-custom-url">
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