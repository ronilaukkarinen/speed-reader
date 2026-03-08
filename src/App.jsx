import { useState, useEffect, useRef, useCallback, memo, useMemo } from "react";
import {
  Minus,
  Plus,
  Info,
  X,
  Keyboard,
  ChevronLeft,
  ChevronRight,
  FileText,
  Upload,
  Settings,
  Link,
  Check,
  Maximize,
  Minimize,
  Share,
  BookOpen,
} from "lucide-react";
import JSZip from "jszip";

// Solid play icon
const PlaySolid = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5v14l11-7z" />
  </svg>
);

// Solid pause icon
const PauseSolid = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
  </svg>
);

const DEFAULT_TEXT = `Welcome to the RSVP Speed Reader! This tool uses Rapid Serial Visual Presentation to help you read faster. Click the text icon in the top left to paste text or load an EPUB file. The reader displays one word at a time at a fixed focal point, reducing eye movement and allowing for faster reading speeds. Research suggests that RSVP can help readers achieve speeds of 500 words per minute or more with practice. Try starting at a comfortable pace and gradually increase the speed as you become more accustomed to the technique. Happy reading!`;

const STORAGE_KEY = "rsvp-reader-settings";
const IOS_BANNER_DISMISSED_KEY = "rsvp-ios-banner-dismissed";

// Detect iOS Safari (not in standalone mode)
function isIOSSafari() {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|OPiOS|mercury/.test(ua);
  const isStandalone = window.navigator.standalone === true;
  return isIOS && isSafari && !isStandalone;
}

// Check if fullscreen API is supported
function isFullscreenSupported() {
  return document.documentElement.requestFullscreen !== undefined;
}

// Simple hash for text to use as key for positions
function hashText(text) {
  let hash = 0;
  const str = text.slice(0, 200); // Use first 200 chars for hash
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString();
}

function loadSettings() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch (e) {
    console.error("Failed to load settings:", e);
  }
  return null;
}

function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error("Failed to save settings:", e);
  }
}

function getPositionForText(text, positions) {
  const hash = hashText(text);
  return positions?.[hash] || 0;
}

function savePositionForText(text, position, positions) {
  const hash = hashText(text);
  return { ...positions, [hash]: position };
}

// Parse EPUB file and extract text and metadata
async function parseEpub(file) {
  const zip = await JSZip.loadAsync(file);

  // Find the container.xml to get the content.opf path
  const containerXml = await zip.file("META-INF/container.xml")?.async("text");
  if (!containerXml) throw new Error("Invalid EPUB: missing container.xml");

  // Parse container.xml to find rootfile path
  const rootfileMatch = containerXml.match(/rootfile[^>]*full-path="([^"]+)"/);
  if (!rootfileMatch) throw new Error("Invalid EPUB: cannot find rootfile");

  const opfPath = rootfileMatch[1];
  const opfDir = opfPath.substring(0, opfPath.lastIndexOf("/") + 1);

  // Read the OPF file
  const opfContent = await zip.file(opfPath)?.async("text");
  if (!opfContent) throw new Error("Invalid EPUB: cannot read OPF");

  // Extract metadata
  const titleMatch = opfContent.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i);
  const authorMatch = opfContent.match(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/i);

  const metadata = {
    title: titleMatch ? titleMatch[1].trim() : null,
    author: authorMatch ? authorMatch[1].trim() : null,
    cover: null,
  };

  // Find cover image - try multiple methods
  // Method 1: Look for meta cover element
  const metaCoverMatch = opfContent.match(/<meta[^>]*name="cover"[^>]*content="([^"]+)"/i);
  // Method 2: Look for item with properties="cover-image"
  const coverImageMatch = opfContent.match(/<item[^>]*properties="cover-image"[^>]*href="([^"]+)"/i);
  // Method 3: Look for item with id containing "cover" and image media-type
  const coverIdMatch = opfContent.match(/<item[^>]*id="[^"]*cover[^"]*"[^>]*href="([^"]+)"[^>]*media-type="image\/[^"]+"/i);
  // Method 4: Alternate format for cover-image property
  const coverImageMatch2 = opfContent.match(/<item[^>]*href="([^"]+)"[^>]*properties="cover-image"/i);

  let coverHref = null;
  if (coverImageMatch) {
    coverHref = coverImageMatch[1];
  } else if (coverImageMatch2) {
    coverHref = coverImageMatch2[1];
  } else if (metaCoverMatch) {
    // Need to find the href for this id
    const coverId = metaCoverMatch[1];
    const itemMatch = opfContent.match(new RegExp(`<item[^>]*id="${coverId}"[^>]*href="([^"]+)"`, "i"));
    if (itemMatch) coverHref = itemMatch[1];
  } else if (coverIdMatch) {
    coverHref = coverIdMatch[1];
  }

  // Load cover image if found (as base64 data URL for persistence)
  if (coverHref) {
    const coverPath = coverHref.startsWith("/") ? coverHref.slice(1) : opfDir + coverHref;
    const coverFile = zip.file(coverPath);
    if (coverFile) {
      const coverBase64 = await coverFile.async("base64");
      const mimeMatch = coverHref.match(/\.(jpe?g|png|gif|webp)$/i);
      const mimeType = mimeMatch ? `image/${mimeMatch[1].toLowerCase().replace("jpg", "jpeg")}` : "image/jpeg";
      metadata.cover = `data:${mimeType};base64,${coverBase64}`;
    }
  }

  // Get spine items (reading order)
  const spineMatches = [
    ...opfContent.matchAll(/<itemref[^>]*idref="([^"]+)"/g),
  ];
  const manifestMatches = [
    ...opfContent.matchAll(
      /<item[^>]*id="([^"]+)"[^>]*href="([^"]+)"[^>]*media-type="application\/xhtml\+xml"/g,
    ),
  ];

  // Also try alternate manifest format
  const manifestMatches2 = [
    ...opfContent.matchAll(
      /<item[^>]*href="([^"]+)"[^>]*id="([^"]+)"[^>]*media-type="application\/xhtml\+xml"/g,
    ),
  ];

  // Build manifest map
  const manifest = {};
  manifestMatches.forEach((m) => {
    manifest[m[1]] = m[2];
  });
  manifestMatches2.forEach((m) => {
    manifest[m[2]] = m[1];
  });

  // Get ordered content files
  const contentFiles = spineMatches.map((m) => manifest[m[1]]).filter(Boolean);

  // If spine parsing failed, try to get all xhtml files
  if (contentFiles.length === 0) {
    const allFiles = Object.keys(zip.files).filter(
      (f) => f.endsWith(".xhtml") || f.endsWith(".html") || f.endsWith(".htm"),
    );
    contentFiles.push(...allFiles);
  }

  // Extract text from each content file
  let fullText = "";
  for (const href of contentFiles) {
    const filePath = href.startsWith("/") ? href.slice(1) : opfDir + href;
    const content = await zip.file(filePath)?.async("text");
    if (content) {
      // Strip HTML tags, preserve paragraph breaks
      const textContent = content
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<\/?(p|div|br|h[1-6]|blockquote|li|tr)[^>]*>/gi, "\n\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
        .replace(/[^\S\n]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      if (textContent) {
        fullText += textContent + " ";
      }
    }
  }

  return { text: fullText.trim(), metadata };
}

// Parse text into words and paragraph break positions
function parseText(text) {
  const paragraphs = text.split(/\n\n+/);
  const words = [];
  const breaks = new Set();
  for (const para of paragraphs) {
    const paraWords = para.trim().split(/\s+/).filter((w) => w.length > 0);
    if (paraWords.length > 0) {
      if (words.length > 0) {
        breaks.add(words.length);
      }
      words.push(...paraWords);
    }
  }
  return { words, breaks };
}

// Spritz ORP algorithm - position where the eye naturally fixates
// Based on Optimal Viewing Position research (20-35% from left)
function getORPIndex(wordLength) {
  if (wordLength === 0) return 0;
  if (wordLength === 1) return 0; // 1 char: 1st letter
  if (wordLength <= 5) return 1; // 2-5 chars: 2nd letter
  if (wordLength <= 9) return 2; // 6-9 chars: 3rd letter
  if (wordLength <= 13) return 3; // 10-13 chars: 4th letter
  return 4; // 14+ chars: 5th letter
}

function getWordDelay(word, baseDelay) {
  let multiplier = 1;
  multiplier += Math.sqrt(word.length) * 0.04;
  if (/[.!?]$/.test(word)) {
    multiplier = 2.5;
  } else if (/[,;:]$/.test(word)) {
    multiplier = 1.8;
  }
  return baseDelay * multiplier;
}

// Format reading time in human-readable format
function formatReadingTime(minutes) {
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

// Fetch book metadata from Open Library API
async function fetchMetadataFromOpenLibrary(title, author) {
  if (!title && !author) return null;

  try {
    const query = [title, author].filter(Boolean).join(" ");
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=1&fields=title,author_name,cover_i`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    if (!data.docs || data.docs.length === 0) return null;

    const book = data.docs[0];
    return {
      title: book.title || null,
      author: book.author_name?.[0] || null,
      cover: book.cover_i
        ? `https://covers.openlibrary.org/b/id/${book.cover_i}-M.jpg`
        : null,
    };
  } catch (e) {
    console.error("Failed to fetch from Open Library:", e);
    return null;
  }
}

function joinWordsWithBreaks(words, startIdx, endIdx, breaks) {
  const parts = [];
  for (let i = startIdx; i < endIdx; i++) {
    if (i > startIdx && breaks.has(i)) {
      parts.push("\n\n");
    } else if (i > startIdx) {
      parts.push(" ");
    }
    parts.push(words[i]);
  }
  return parts.join("");
}

const BookView = memo(function BookView({ words, currentIndex, sideOpacity, setCurrentIndex, setIsPlaying, paragraphBreaks }) {
  const dragRef = useRef({ active: false, startY: 0, startIndex: 0 });
  const bgContainerRef = useRef(null);
  const bgTextRef = useRef(null);
  const markerRef = useRef(null);
  const bgWindowRef = useRef({ start: 0, end: 0 });

  // Chunked background window — only shift when near edges to avoid flicker
  const bgHalf = 500;
  const bgBuffer = 100;
  const prev = bgWindowRef.current;
  let bgStart = prev.start;
  let bgEnd = prev.end;
  if (currentIndex - bgStart < bgBuffer || bgEnd - currentIndex < bgBuffer || prev.start === prev.end) {
    bgStart = Math.max(0, currentIndex - bgHalf);
    bgEnd = Math.min(words.length, currentIndex + bgHalf);
    bgWindowRef.current = { start: bgStart, end: bgEnd };
  }

  const bgPastText = useMemo(() =>
    joinWordsWithBreaks(words, bgStart, currentIndex, paragraphBreaks),
    [words, bgStart, currentIndex, paragraphBreaks]
  );

  const bgFutureText = useMemo(() =>
    joinWordsWithBreaks(words, currentIndex + 1, bgEnd, paragraphBreaks),
    [words, currentIndex, bgEnd, paragraphBreaks]
  );

  const activeWord = words[currentIndex] || "";
  const orpIdx = getORPIndex(activeWord.length);
  const before = activeWord.slice(0, orpIdx);
  const orp = activeWord[orpIdx] || "";
  const after = activeWord.slice(orpIdx + 1);

  // Scroll background to center the active word marker
  useEffect(() => {
    if (markerRef.current && bgTextRef.current && bgContainerRef.current) {
      const containerH = bgContainerRef.current.clientHeight;
      const markerTop = markerRef.current.offsetTop - bgTextRef.current.offsetTop;
      const markerH = markerRef.current.offsetHeight;
      const offset = containerH / 2 - markerTop - markerH / 2;
      bgTextRef.current.style.transform = `translateY(${offset}px)`;
    }
  }, [currentIndex]);

  const onDragStart = useCallback((clientY) => {
    setIsPlaying(false);
    dragRef.current = { active: true, startY: clientY, startIndex: currentIndex };
  }, [currentIndex, setIsPlaying]);

  const onDragMove = useCallback((clientY) => {
    if (!dragRef.current.active) return;
    const dy = dragRef.current.startY - clientY;
    const wordDelta = Math.round(dy / 20);
    const newIndex = Math.max(0, Math.min(words.length - 1, dragRef.current.startIndex + wordDelta));
    setCurrentIndex(newIndex);
  }, [words.length, setCurrentIndex]);

  const onDragEnd = useCallback(() => {
    dragRef.current.active = false;
  }, []);

  useEffect(() => {
    const handleMouseMove = (e) => onDragMove(e.clientY);
    const handleMouseUp = () => onDragEnd();
    const handleTouchMove = (e) => onDragMove(e.touches[0].clientY);
    const handleTouchEnd = () => onDragEnd();

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("touchmove", handleTouchMove);
    window.addEventListener("touchend", handleTouchEnd);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [onDragMove, onDragEnd]);

  return (
    <div
      style={styles.bvOuter}
      onMouseDown={(e) => onDragStart(e.clientY)}
      onTouchStart={(e) => onDragStart(e.touches[0].clientY)}
    >
      {/* Background: continuous book text, dimmed */}
      <div ref={bgContainerRef} style={styles.bvBg}>
        <div ref={bgTextRef} style={styles.bvBgText}>
          {bgPastText}
          {bgPastText ? (paragraphBreaks.has(currentIndex) ? "\n\n" : " ") : ""}
          <span ref={markerRef} style={styles.bvBgActiveWord}>{activeWord}</span>
          {paragraphBreaks.has(currentIndex + 1) ? "\n\n" : " "}
          {bgFutureText}
        </div>
      </div>

      {/* Foreground: ORP center display */}
      <div style={{ flex: 1 }} />
      <div style={styles.bvCenter}>
        <div style={styles.bvDisplayArea}>
          <div style={styles.bvFocalGuide}>
            <div style={styles.bvFocalLine} />
            <div style={styles.bvFocalMarker} />
            <div style={styles.bvFocalLine} />
          </div>

          <div style={styles.bvWordContainer}>
            <div
              style={{
                ...styles.bvWordDisplay,
                transform: `translateY(-50%) translateX(calc(-${orpIdx}ch - 0.5ch))`,
              }}
              className="mono"
            >
              <span style={{ ...styles.beforeORP, opacity: sideOpacity }}>
                {before}
              </span>
              <span style={styles.orpChar}>{orp}</span>
              <span style={{ ...styles.afterORP, opacity: sideOpacity }}>
                {after}
              </span>
            </div>
          </div>

          <div style={styles.bvFocalGuide}>
            <div style={styles.bvFocalLine} />
            <div style={styles.bvFocalMarker} />
            <div style={styles.bvFocalLine} />
          </div>
        </div>
      </div>
      <div style={{ flex: 1 }} />
    </div>
  );
});

function App() {
  // Load settings only once on mount
  const [savedSettings] = useState(() => loadSettings());
  const positionsRef = useRef(savedSettings?.positions || {});

  const [text, setText] = useState(() => savedSettings?.text || DEFAULT_TEXT);
  const initialParsed = useState(() => parseText(savedSettings?.text || DEFAULT_TEXT))[0];
  const [words, setWords] = useState(() => initialParsed.words);
  const [paragraphBreaks, setParagraphBreaks] = useState(() => initialParsed.breaks);
  const [_currentIndex, _setCurrentIndex] = useState(() => {
    const wordCount = initialParsed.words.length;
    const clamp = (v) => Math.min(Math.max(0, v), Math.max(0, wordCount - 1));

    // Check URL hash for shared links
    const hash = window.location.hash;
    if (hash) {
      const params = new URLSearchParams(hash.slice(1));
      const urlPos = parseInt(params.get("pos"), 10);
      if (!isNaN(urlPos) && urlPos >= 0) {
        return clamp(urlPos);
      }
    }

    // Read from dedicated lightweight key
    try {
      const stored = localStorage.getItem("rsvp-current-index");
      if (stored != null) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed) && parsed >= 0) {
          return clamp(parsed);
        }
      }
    } catch {}

    // Fallback to settings bundle
    const savedIdx = savedSettings?.currentIndex;
    if (savedIdx != null) return clamp(savedIdx);

    return clamp(getPositionForText(savedSettings?.text || DEFAULT_TEXT, savedSettings?.positions || {}));
  });

  // Wrap setCurrentIndex to save synchronously on every call
  const currentIndex = _currentIndex;
  const setCurrentIndex = useCallback((valueOrFn) => {
    _setCurrentIndex((prev) => {
      const next = typeof valueOrFn === "function" ? valueOrFn(prev) : valueOrFn;
      try { localStorage.setItem("rsvp-current-index", String(next)); } catch {}
      return next;
    });
  }, []);
  const [isPlaying, setIsPlaying] = useState(false);
  const [wpm, setWpm] = useState(() => savedSettings?.wpm || 300);
  const [showInfo, setShowInfo] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showTextInput, setShowTextInput] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [bookMetadata, setBookMetadata] = useState(
    () => savedSettings?.bookMetadata || null,
  );
  const [sideOpacity, setSideOpacity] = useState(
    () => savedSettings?.sideOpacity ?? 0.5,
  );
  const [bookView, setBookView] = useState(
    () => savedSettings?.bookView ?? false,
  );
  const [fetchMetadataOnline, setFetchMetadataOnline] = useState(
    () => savedSettings?.fetchMetadataOnline ?? false,
  );
  const [linkCopied, setLinkCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showIOSBanner, setShowIOSBanner] = useState(() => {
    if (!isIOSSafari()) return false;
    try {
      return localStorage.getItem(IOS_BANNER_DISMISSED_KEY) !== "true";
    } catch {
      return true;
    }
  });
  const timeoutRef = useRef(null);
  const prevTextRef = useRef(text);
  const fileInputRef = useRef(null);


  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoadingFile(true);
    try {
      if (file.name.endsWith(".epub")) {
        const result = await parseEpub(file);
        setText(result.text);

        let metadata = result.metadata;
        // Fetch missing metadata from Open Library if enabled
        if (fetchMetadataOnline && (!metadata.title || !metadata.cover)) {
          const onlineMetadata = await fetchMetadataFromOpenLibrary(
            metadata.title,
            metadata.author,
          );
          if (onlineMetadata) {
            metadata = {
              title: metadata.title || onlineMetadata.title,
              author: metadata.author || onlineMetadata.author,
              cover: metadata.cover || onlineMetadata.cover,
            };
          }
        }
        setBookMetadata(metadata);
      } else if (file.name.endsWith(".txt")) {
        const textContent = await file.text();
        setText(textContent);
        setBookMetadata(null);
      } else {
        alert("Please upload an EPUB or TXT file");
      }
    } catch (err) {
      console.error("Error loading file:", err);
      alert("Error loading file: " + err.message);
    } finally {
      setIsLoadingFile(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  // Handle text changes (not on initial mount)
  useEffect(() => {
    if (text !== prevTextRef.current) {
      const { words: parsed, breaks } = parseText(text);
      setWords(parsed);
      setParagraphBreaks(breaks);
      // Text changed, load position for new text
      const savedPos = getPositionForText(text, positionsRef.current);
      setCurrentIndex(
        Math.min(Math.max(0, savedPos), Math.max(0, parsed.length - 1)),
      );
      prevTextRef.current = text;
      setIsPlaying(false);
    }
  }, [text]);



  // Save settings including position for current text
  useEffect(() => {
    positionsRef.current = savePositionForText(
      text,
      currentIndex,
      positionsRef.current,
    );
    saveSettings({
      wpm,
      text,
      currentIndex,
      positions: positionsRef.current,
      sideOpacity,
      bookView,
      bookMetadata,
      fetchMetadataOnline,
    });
  }, [wpm, text, currentIndex, sideOpacity, bookView, bookMetadata, fetchMetadataOnline]);

  // Update URL hash with current position in real time
  useEffect(() => {
    if (words.length > 0) {
      window.history.replaceState(null, "", `${window.location.pathname}#pos=${currentIndex}`);
    }
  }, [currentIndex, words.length]);

  const getBaseDelay = useCallback(() => {
    return (60 / wpm) * 1000;
  }, [wpm]);

  useEffect(() => {
    if (isPlaying && words.length > 0 && currentIndex < words.length) {
      const currentWord = words[currentIndex];
      const delay = getWordDelay(currentWord, getBaseDelay());

      timeoutRef.current = setTimeout(() => {
        setCurrentIndex((prev) => {
          if (prev + 1 >= words.length) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, delay);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [isPlaying, currentIndex, words, getBaseDelay]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT")
        return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowRight":
          e.preventDefault();
          if (e.shiftKey) {
            setCurrentIndex((prev) => Math.min(words.length - 1, prev + 10));
          } else {
            setCurrentIndex((prev) => Math.min(words.length - 1, prev + 1));
          }
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (e.shiftKey) {
            setCurrentIndex((prev) => Math.max(0, prev - 10));
          } else {
            setCurrentIndex((prev) => Math.max(0, prev - 1));
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          adjustWpm(25);
          break;
        case "ArrowDown":
          e.preventDefault();
          adjustWpm(-25);
          break;
        case "r":
        case "R":
          if (e.ctrlKey || e.metaKey) break; // Allow browser refresh
          e.preventDefault();
          reset();
          break;
        case "b":
        case "B":
          e.preventDefault();
          setBookView((prev) => !prev);
          break;
        case "Escape":
          setShowInfo(false);
          setShowShortcuts(false);
          setShowTextInput(false);
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPlaying, words.length]);

  const getCurrentWord = () => {
    if (words.length === 0) return "";
    return words[currentIndex] || "";
  };

  const togglePlay = () => {
    if (currentIndex >= words.length - 1) {
      setCurrentIndex(0);
    }
    setIsPlaying(!isPlaying);
  };

  const reset = () => {
    setIsPlaying(false);
    setCurrentIndex(0);
  };

  const adjustWpm = (delta) => {
    setWpm((prev) => Math.max(50, Math.min(1500, prev + delta)));
  };

  const copyPositionUrl = async () => {
    const url = `${window.location.origin}${window.location.pathname}#pos=${currentIndex}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch (e) {
      console.error("Failed to copy URL:", e);
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (e) {
      console.error("Fullscreen error:", e);
    }
  };

  const dismissIOSBanner = () => {
    setShowIOSBanner(false);
    try {
      localStorage.setItem(IOS_BANNER_DISMISSED_KEY, "true");
    } catch {
      // Ignore storage errors
    }
  };

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const handleProgressClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const newIndex = Math.floor(percentage * words.length);
    setCurrentIndex(Math.max(0, Math.min(words.length - 1, newIndex)));
  };

  const stepWord = (delta) => {
    setCurrentIndex((prev) =>
      Math.max(0, Math.min(words.length - 1, prev + delta)),
    );
  };

  const progress =
    words.length > 0 ? ((currentIndex + 1) / words.length) * 100 : 0;
  const currentText = getCurrentWord();
  const orpIndex = getORPIndex(currentText.length);

  const beforeORP = currentText.slice(0, orpIndex);
  const orpChar = currentText[orpIndex] || "";
  const afterORP = currentText.slice(orpIndex + 1);

  return (
    <div style={styles.container}>
      {/* Top controls */}
      <div style={styles.topBar} className="top-bar">
        <div style={styles.topLeft}>
          <button
            onClick={() => setShowTextInput(!showTextInput)}
            style={{
              ...styles.textBtn,
              ...(showTextInput ? styles.textBtnActive : {}),
            }}
            className="icon-btn"
            title="Edit text"
          >
            <FileText size={16} />
            <span className="text-btn-label">Text</span>
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            style={styles.textBtn}
            className="icon-btn"
            title="Upload EPUB or TXT"
            disabled={isLoadingFile}
          >
            <Upload size={16} />
            <span className="text-btn-label">{isLoadingFile ? "Loading..." : "Upload"}</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".epub,.txt"
            onChange={handleFileUpload}
            style={{ display: "none" }}
          />
          {isFullscreenSupported() && (
            <button
              onClick={toggleFullscreen}
              style={styles.textBtn}
              className="icon-btn"
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
            </button>
          )}
        </div>
        <div style={styles.topCenter}>
          <div style={styles.wpmControl} className="wpm-control">
            <button
              onClick={() => adjustWpm(-25)}
              style={styles.wpmBtn}
              className="wpm-btn"
            >
              <Minus size={16} />
            </button>
            <div style={styles.wpmDisplay}>
              <span style={styles.wpmValue} className="wpm-value">
                {wpm}
              </span>
              <span style={styles.wpmLabel}>WPM</span>
            </div>
            <button
              onClick={() => adjustWpm(25)}
              style={styles.wpmBtn}
              className="wpm-btn"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>
        <div style={styles.topRight}>
          <button
            onClick={() => setBookView(!bookView)}
            style={{
              ...styles.iconBtn,
              ...(bookView ? styles.iconBtnActive : {}),
            }}
            className="icon-btn"
            title="Book view"
          >
            <BookOpen size={18} />
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            style={styles.iconBtn}
            className="icon-btn"
            title="Settings"
          >
            <Settings size={18} />
          </button>
          <button
            onClick={() => setShowShortcuts(!showShortcuts)}
            style={styles.iconBtn}
            className="icon-btn"
            title="Keyboard shortcuts"
          >
            <Keyboard size={18} />
          </button>
          <button
            onClick={() => setShowInfo(!showInfo)}
            style={styles.iconBtn}
            className="icon-btn"
            title="How it works"
          >
            <Info size={18} />
          </button>
        </div>
      </div>

      {/* Text input panel - fixed position overlay */}
      {showTextInput && (
        <div style={styles.textInputOverlay}>
          <div style={styles.textInputPanel}>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              style={styles.textarea}
              placeholder="Paste your text here..."
              rows={8}
              autoFocus
            />
          </div>
        </div>
      )}

      {/* Main display area */}
      {bookView ? (
        <BookView
          words={words}
          currentIndex={currentIndex}
          sideOpacity={sideOpacity}
          setCurrentIndex={setCurrentIndex}
          setIsPlaying={setIsPlaying}
          paragraphBreaks={paragraphBreaks}
        />
      ) : (
        <div style={styles.mainArea} className="main-area">
          <div style={styles.displayArea}>
            <div style={styles.focalGuide}>
              <div style={styles.focalLine} />
              <div style={styles.focalMarker} />
              <div style={styles.focalLine} />
            </div>

            <div style={styles.wordContainer} className="word-container">
              {currentText ? (
                <div
                  style={{
                    ...styles.wordDisplay,
                    transform: `translateY(-50%) translateX(calc(-${orpIndex}ch - 0.5ch))`,
                  }}
                  className="mono word-display"
                >
                  <span style={{ ...styles.beforeORP, opacity: sideOpacity }}>
                    {beforeORP}
                  </span>
                  <span style={styles.orpChar}>{orpChar}</span>
                  <span style={{ ...styles.afterORP, opacity: sideOpacity }}>
                    {afterORP}
                  </span>
                </div>
              ) : (
                <div
                  style={{
                    ...styles.wordDisplay,
                    transform: "translateY(-50%) translateX(-50%)",
                  }}
                  className="mono word-display"
                >
                  <span style={styles.placeholder}>Ready</span>
                </div>
              )}
            </div>

            <div style={styles.focalGuide}>
              <div style={styles.focalLine} />
              <div style={styles.focalMarker} />
              <div style={styles.focalLine} />
            </div>
          </div>
        </div>
      )}

      {/* Bottom controls */}
      <div style={styles.bottomArea} className="bottom-area">
        {/* Controls with play button in center */}
        <div style={styles.controlsRow}>
          <button
            onClick={() => stepWord(-10)}
            style={styles.skipBtn}
            title="Back 10 words"
          >
            <ChevronLeft size={24} />
            <ChevronLeft size={24} style={{ marginLeft: -14 }} />
          </button>
          <button onClick={togglePlay} style={styles.playBtn} className="play-btn">
            {isPlaying ? <PauseSolid size={32} /> : <PlaySolid size={32} />}
          </button>
          <button
            onClick={() => stepWord(10)}
            style={styles.skipBtn}
            title="Forward 10 words"
          >
            <ChevronRight size={24} />
            <ChevronRight size={24} style={{ marginLeft: -14 }} />
          </button>
        </div>

        {/* Progress */}
        <div
          style={styles.progressContainer}
          onClick={handleProgressClick}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              setCurrentIndex((prev) => Math.max(0, prev - Math.ceil(words.length / 100)));
            } else if (e.key === "ArrowRight") {
              e.preventDefault();
              setCurrentIndex((prev) => Math.min(words.length - 1, prev + Math.ceil(words.length / 100)));
            }
          }}
          role="slider"
          tabIndex={0}
          aria-label="Reading progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
          aria-valuetext={`${Math.round(progress)}% complete, word ${currentIndex + 1} of ${words.length}`}
        >
          <div style={{ ...styles.progressBar, width: `${progress}%` }} />
        </div>
        <div style={styles.progressRow}>
          <div style={styles.progressText}>
            {currentIndex + 1} / {words.length} ({Math.round(progress)}%)
          </div>
          <button
            onClick={copyPositionUrl}
            style={styles.linkBtn}
            className="icon-btn"
            title="Copy link to current position"
          >
            {linkCopied ? <Check size={14} /> : <Link size={14} />}
            <span style={styles.linkBtnText}>{linkCopied ? "Copied" : "Copy link"}</span>
          </button>
        </div>

        <div style={styles.hint} className="hint">
          <kbd style={styles.kbd}>Space</kbd> play
          <kbd style={styles.kbd}>←</kbd>
          <kbd style={styles.kbd}>→</kbd> word
          <kbd style={styles.kbd}>↑</kbd>
          <kbd style={styles.kbd}>↓</kbd> speed
          <kbd style={styles.kbd}>R</kbd> reset
          <kbd style={styles.kbd}>B</kbd> book
        </div>

        {/* Book metadata display */}
        {bookMetadata && (bookMetadata.title || bookMetadata.cover) && (
          <aside style={styles.bookMetadata} aria-label="Current book" className="book-metadata">
            {bookMetadata.cover && (
              <img
                src={bookMetadata.cover}
                alt={`Cover of ${bookMetadata.title || "current book"}`}
                style={styles.bookCover}
                className="book-cover"
              />
            )}
            <div style={styles.bookInfo}>
              {bookMetadata.title && (
                <h3 style={styles.bookTitle} className="book-title">{bookMetadata.title}</h3>
              )}
              {bookMetadata.author && (
                <p style={styles.bookAuthor} className="book-author">{bookMetadata.author}</p>
              )}
              <p style={styles.bookStats} className="book-stats">
                {formatReadingTime((words.length - currentIndex) / wpm)} left
              </p>
            </div>
          </aside>
        )}
      </div>

      {/* Keyboard shortcuts modal */}
      {showShortcuts && (
        <div
          style={styles.modalOverlay}
          onClick={() => setShowShortcuts(false)}
          role="presentation"
        >
          <div
            style={styles.modal} className="modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortcuts-title"
          >
            <div style={styles.modalHeader}>
              <h2 id="shortcuts-title" style={styles.modalTitle}>Keyboard shortcuts</h2>
              <button
                onClick={() => setShowShortcuts(false)}
                style={styles.closeBtn}
              >
                <X size={20} />
              </button>
            </div>
            <div style={{ padding: "20px" }}>
              <div style={styles.shortcutList}>
                <div style={styles.shortcutRow}>
                  <kbd style={styles.kbdLarge}>Space</kbd>
                  <span>Play / Pause</span>
                </div>
                <div style={styles.shortcutRow}>
                  <kbd style={styles.kbdLarge}>←</kbd>
                  <span>Previous word</span>
                </div>
                <div style={styles.shortcutRow}>
                  <kbd style={styles.kbdLarge}>→</kbd>
                  <span>Next word</span>
                </div>
                <div style={styles.shortcutRow}>
                  <kbd style={styles.kbdLarge}>Shift + ←</kbd>
                  <span>Back 10 words</span>
                </div>
                <div style={styles.shortcutRow}>
                  <kbd style={styles.kbdLarge}>Shift + →</kbd>
                  <span>Forward 10 words</span>
                </div>
                <div style={styles.shortcutRow}>
                  <kbd style={styles.kbdLarge}>↑</kbd>
                  <span>Increase speed</span>
                </div>
                <div style={styles.shortcutRow}>
                  <kbd style={styles.kbdLarge}>↓</kbd>
                  <span>Decrease speed</span>
                </div>
                <div style={styles.shortcutRow}>
                  <kbd style={styles.kbdLarge}>R</kbd>
                  <span>Reset to beginning</span>
                </div>
                <div style={styles.shortcutRow}>
                  <kbd style={styles.kbdLarge}>B</kbd>
                  <span>Toggle book view</span>
                </div>
                <div style={styles.shortcutRow}>
                  <kbd style={styles.kbdLarge}>Esc</kbd>
                  <span>Close dialogs</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* How it works modal */}
      {showInfo && (
        <div style={styles.modalOverlay} onClick={() => setShowInfo(false)} role="presentation">
          <div
            style={styles.modal} className="modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="info-title"
          >
            <div style={styles.modalHeader}>
              <h2 id="info-title" style={styles.modalTitle}>How RSVP speed reading works</h2>
              <button
                onClick={() => setShowInfo(false)}
                style={styles.closeBtn}
              >
                <X size={20} />
              </button>
            </div>
            <div style={styles.modalContent}>
              <h3 style={styles.sectionTitle}>The science</h3>
              <p style={styles.paragraph}>
                <a
                  href="https://en.wikipedia.org/wiki/Rapid_serial_visual_presentation"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={styles.link}
                >
                  RSVP (Rapid Serial Visual Presentation)
                </a>{" "}
                displays text one word at a time at a fixed focal point. This
                eliminates eye movements (
                <a
                  href="https://en.wikipedia.org/wiki/Saccade"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={styles.link}
                >
                  saccades
                </a>
                ) that normally slow down reading — your eyes make 3-4 saccades
                per second during normal reading, each taking 20-30ms.
              </p>

              <h3 style={styles.sectionTitle}>
                Optimal Recognition Point (ORP)
              </h3>
              <p style={styles.paragraph}>
                Research on the{" "}
                <a
                  href="https://en.wikipedia.org/wiki/Optimal_viewing_position"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={styles.link}
                >
                  Optimal Viewing Position
                </a>{" "}
                shows that eyes naturally fixate slightly left of center when
                recognizing words — typically 20-35% from the beginning. The{" "}
                <span style={{ color: "#ff6b6b" }}>red letter</span> marks this
                point, staying fixed so your eyes never move.
              </p>

              <h3 style={styles.sectionTitle}>Spritz ORP positioning</h3>
              <p style={styles.paragraph}>
                This reader uses the Spritz algorithm for ORP placement:
              </p>
              <ul style={styles.list}>
                <li>1 character: 1st letter</li>
                <li>2-5 characters: 2nd letter</li>
                <li>6-9 characters: 3rd letter</li>
                <li>10-13 characters: 4th letter</li>
                <li>14+ characters: 5th letter</li>
              </ul>

              <h3 style={styles.sectionTitle}>Research findings</h3>
              <p style={styles.paragraph}>
                Studies show RSVP can achieve 500+ WPM, though comprehension may
                decrease above 350-400 WPM for complex texts. Best for light
                reading, skimming, and building speed gradually.
              </p>

              <h3 style={styles.sectionTitle}>Tips</h3>
              <ul style={styles.list}>
                <li>Start at 250-300 WPM and gradually increase</li>
                <li>Focus on the red letter, let words come to you</li>
                <li>Take breaks to avoid eye fatigue</li>
              </ul>

              <h3 style={styles.sectionTitle}>Source code</h3>
              <p style={styles.paragraph}>
                This project is open source and available on{" "}
                <a
                  href="https://github.com/ronilaukkarinen/speed-reader"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={styles.link}
                >
                  GitHub
                </a>
                .
              </p>
            </div>
          </div>
        </div>
      )}

      {/* iOS install banner */}
      {showIOSBanner && (
        <div style={styles.iosBanner}>
          <div style={styles.iosBannerContent}>
            <Share size={16} style={{ flexShrink: 0 }} />
            <span>For fullscreen, tap Share then "Add to Home Screen"</span>
          </div>
          <button
            onClick={dismissIOSBanner}
            style={styles.iosBannerClose}
            aria-label="Dismiss"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Settings modal */}
      {showSettings && (
        <div style={styles.modalOverlay} onClick={() => setShowSettings(false)} role="presentation">
          <div
            style={styles.modal} className="modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
          >
            <div style={styles.modalHeader}>
              <h2 id="settings-title" style={styles.modalTitle}>Settings</h2>
              <button
                onClick={() => setShowSettings(false)}
                style={styles.closeBtn}
              >
                <X size={20} />
              </button>
            </div>
            <div style={{ padding: "20px" }}>
              <div style={styles.settingRow}>
                <label style={styles.settingLabel}>Side opacity</label>
                <div style={styles.settingControl}>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={sideOpacity * 100}
                    onChange={(e) => setSideOpacity(e.target.value / 100)}
                    style={styles.slider}
                  />
                  <span style={styles.settingValue}>
                    {Math.round(sideOpacity * 100)}%
                  </span>
                </div>
              </div>
              <div style={styles.settingRow}>
                <label style={styles.settingLabel}>
                  <span>Fetch missing metadata online</span>
                  <span style={styles.settingHint}>Uses Open Library API</span>
                </label>
                <div style={styles.settingControl}>
                  <button
                    onClick={() => setFetchMetadataOnline(!fetchMetadataOnline)}
                    style={{
                      ...styles.toggleBtn,
                      backgroundColor: fetchMetadataOnline ? "#ff6b6b" : "#333",
                    }}
                    aria-pressed={fetchMetadataOnline}
                  >
                    <span
                      style={{
                        ...styles.toggleKnob,
                        transform: fetchMetadataOnline
                          ? "translateX(16px)"
                          : "translateX(0)",
                      }}
                    />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    backgroundColor: "#0a0a0a",
    overflow: "hidden",
  },

  // Top bar
  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "20px 32px",
  },
  topLeft: {
    flex: 1,
    display: "flex",
    justifyContent: "flex-start",
  },
  topCenter: {
    flex: 1,
    display: "flex",
    justifyContent: "center",
  },
  topRight: {
    flex: 1,
    display: "flex",
    justifyContent: "flex-end",
    gap: "4px",
  },
  iconBtn: {
    background: "transparent",
    border: "none",
    borderRadius: "8px",
    padding: "10px",
    cursor: "pointer",
    color: "rgb(98, 98, 98)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtnActive: {
    color: "#fff",
    backgroundColor: "#1a1a1a",
  },
  textBtn: {
    backgroundColor: "transparent",
    border: "none",
    borderRadius: "8px",
    padding: "10px",
    cursor: "pointer",
    color: "rgb(98, 98, 98)",
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontSize: "0.8rem",
    fontWeight: "500",
    outline: "none",
    WebkitAppearance: "none",
  },
  textBtnActive: {
    color: "#fff",
    backgroundColor: "#1a1a1a",
  },
  wpmControl: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  wpmBtn: {
    background: "transparent",
    border: "none",
    borderRadius: "6px",
    padding: "8px",
    cursor: "pointer",
    color: "rgb(98, 98, 98)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  wpmDisplay: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    minWidth: "60px",
  },
  wpmValue: {
    fontSize: "1.5rem",
    fontWeight: "600",
    color: "rgb(98, 98, 98)",
  },
  wpmLabel: {
    fontSize: "0.6rem",
    color: "rgb(98, 98, 98)",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },

  // Text input panel
  textInputOverlay: {
    position: "fixed",
    top: "70px",
    left: "50%",
    transform: "translateX(-50%)",
    width: "100%",
    maxWidth: "700px",
    padding: "0 32px",
    zIndex: 100,
  },
  textInputPanel: {
    backgroundColor: "#0a0a0a",
    borderRadius: "12px",
    padding: "4px",
    border: "1px solid #222",
  },
  textarea: {
    width: "100%",
    padding: "16px",
    fontSize: "0.9rem",
    fontFamily: "'Inter', sans-serif",
    backgroundColor: "#111",
    border: "1px solid #1a1a1a",
    borderRadius: "8px",
    color: "#ccc",
    resize: "vertical",
    lineHeight: "1.7",
  },

  // Main display area
  mainArea: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 48px",
  },
  displayArea: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    width: "100%",
    maxWidth: "900px",
  },
  focalGuide: {
    display: "flex",
    alignItems: "center",
    width: "100%",
    justifyContent: "center",
  },
  focalLine: {
    flex: 1,
    height: "1px",
    backgroundColor: "#1a1a1a",
    maxWidth: "180px",
  },
  focalMarker: {
    width: "1px",
    height: "35px",
    backgroundColor: "#1a1a1a",
  },
  wordContainer: {
    width: "100%",
    height: "160px",
    position: "relative",
    overflow: "visible",
  },
  wordDisplay: {
    position: "absolute",
    top: "50%",
    left: "50%",
    fontSize: "5.25rem",
    fontWeight: "500",
    whiteSpace: "nowrap",
    display: "flex",
    alignItems: "center",
  },
  beforeORP: {
    color: "#ffffff",
  },
  orpChar: {
    color: "#ff6b6b",
    display: "inline-block",
    width: "1ch",
    textAlign: "center",
    filter: "drop-shadow(0 0 20px rgba(220, 38, 38, 0.6))",
  },
  afterORP: {
    color: "#ffffff",
  },
  placeholder: {
    color: "rgb(98, 98, 98)",
  },

  // Bottom area
  bottomArea: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "16px 48px 40px",
    gap: "16px",
  },
  controlsRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "4px",
    marginBottom: "20px",
  },
  skipBtn: {
    background: "transparent",
    border: "none",
    borderRadius: "8px",
    width: "44px",
    height: "44px",
    cursor: "pointer",
    color: "rgb(98, 98, 98)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  playBtn: {
    background: "#ff6b6b",
    border: "none",
    borderRadius: "50%",
    width: "72px",
    height: "72px",
    cursor: "pointer",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: "0 12px",
  },
  progressContainer: {
    width: "100%",
    maxWidth: "600px",
    height: "4px",
    backgroundColor: "#1a1a1a",
    borderRadius: "2px",
    overflow: "hidden",
    cursor: "pointer",
  },
  progressBar: {
    height: "100%",
    backgroundColor: "#ff6b6b",
    transition: "width 0.05s linear",
  },
  progressRow: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  progressText: {
    fontSize: "0.7rem",
    color: "rgb(98, 98, 98)",
  },
  linkBtn: {
    background: "transparent",
    border: "none",
    borderRadius: "4px",
    padding: "4px 8px",
    cursor: "pointer",
    color: "rgb(98, 98, 98)",
    display: "flex",
    alignItems: "center",
    gap: "4px",
    fontSize: "0.7rem",
  },
  linkBtnText: {
    fontSize: "0.65rem",
  },
  hint: {
    fontSize: "0.7rem",
    color: "rgb(98, 98, 98)",
    display: "flex",
    gap: "12px",
    alignItems: "center",
    marginTop: "8px",
  },
  kbd: {
    backgroundColor: "#1a1a1a",
    padding: "3px 6px",
    borderRadius: "4px",
    fontSize: "0.65rem",
    color: "rgb(98, 98, 98)",
  },

  // Modal styles
  modalOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.9)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    padding: "20px",
  },
  modal: {
    backgroundColor: "#111",
    borderRadius: "12px",
    maxWidth: "420px",
    width: "100%",
    maxHeight: "80vh",
    overflow: "auto",
    border: "1px solid #1a1a1a",
  },
  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "20px 20px 0 20px",
  },
  modalTitle: {
    fontSize: "1rem",
    fontWeight: "500",
    color: "#fff",
  },
  closeBtn: {
    background: "transparent",
    border: "none",
    color: "rgb(98, 98, 98)",
    cursor: "pointer",
    padding: "4px",
    display: "flex",
  },
  modalContent: {
    padding: "0 20px 20px 20px",
  },
  sectionTitle: {
    fontSize: "0.875rem",
    fontWeight: "500",
    color: "#888",
    marginTop: "16px",
    marginBottom: "8px",
  },
  paragraph: {
    fontSize: "0.8rem",
    color: "rgb(98, 98, 98)",
    lineHeight: "1.6",
    marginBottom: "8px",
  },
  link: {
    color: "rgb(98, 98, 98)",
    textDecoration: "underline",
  },
  list: {
    fontSize: "0.8rem",
    color: "rgb(98, 98, 98)",
    lineHeight: "1.8",
    paddingLeft: "18px",
  },
  settingRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "16px",
  },
  settingLabel: {
    fontSize: "0.875rem",
    color: "rgb(98, 98, 98)",
    display: "flex",
    flexDirection: "column",
  },
  settingControl: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  settingBtn: {
    background: "transparent",
    border: "1px solid #333",
    borderRadius: "4px",
    padding: "4px 8px",
    cursor: "pointer",
    color: "rgb(98, 98, 98)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  settingValue: {
    fontSize: "0.875rem",
    color: "#fff",
    minWidth: "40px",
    textAlign: "center",
  },
  slider: {
    width: "120px",
    accentColor: "#ff6b6b",
  },
  settingHint: {
    display: "block",
    fontSize: "0.7rem",
    color: "#555",
    marginTop: "2px",
  },
  toggleBtn: {
    width: "40px",
    height: "24px",
    borderRadius: "12px",
    border: "none",
    cursor: "pointer",
    position: "relative",
    transition: "background-color 0.2s",
  },
  toggleKnob: {
    position: "absolute",
    top: "3px",
    left: "3px",
    width: "18px",
    height: "18px",
    borderRadius: "50%",
    backgroundColor: "#fff",
    transition: "transform 0.2s",
  },
  shortcutList: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  shortcutRow: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
    fontSize: "0.85rem",
    color: "#666",
  },
  kbdLarge: {
    backgroundColor: "#1a1a1a",
    padding: "6px 10px",
    borderRadius: "4px",
    fontSize: "0.8rem",
    minWidth: "50px",
    textAlign: "center",
    color: "#888",
  },

  // Book metadata
  bookMetadata: {
    display: "flex",
    alignItems: "flex-end",
    gap: "12px",
    maxWidth: "280px",
    marginTop: "16px",
  },
  bookCover: {
    width: "48px",
    height: "auto",
    borderRadius: "4px",
    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.4)",
  },
  bookInfo: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    minWidth: 0,
  },
  bookTitle: {
    fontSize: "0.8rem",
    fontWeight: "500",
    color: "#999",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    margin: 0,
    marginBottom: "2px",
  },
  bookAuthor: {
    fontSize: "0.75rem",
    color: "#666",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    margin: 0,
  },
  bookStats: {
    fontSize: "0.7rem",
    color: "#555",
    margin: 0,
    marginTop: "2px",
  },

  // Book view
  bvOuter: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    minHeight: 0,
    cursor: "grab",
    userSelect: "none",
    position: "relative",
  },
  bvBg: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: "hidden",
    display: "flex",
    justifyContent: "center",
    pointerEvents: "none",
    maskImage: "linear-gradient(to bottom, transparent 0%, #000 20%, #000 80%, transparent 100%)",
    WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, #000 20%, #000 80%, transparent 100%)",
  },
  bvBgText: {
    fontSize: "1rem",
    lineHeight: "2",
    textAlign: "justify",
    hyphens: "auto",
    whiteSpace: "pre-wrap",
    fontFamily: "'Inter', sans-serif",
    color: "#555",
    padding: "0 32px",
    maxWidth: "600px",
    width: "100%",
  },
  bvBgActiveWord: {
    color: "#ff6b6b",
    fontWeight: "700",
    filter: "drop-shadow(0 0 12px rgba(220, 38, 38, 0.5))",
  },
  bvCenter: {
    flexShrink: 0,
    display: "flex",
    justifyContent: "center",
    position: "relative",
    zIndex: 1,
  },
  bvDisplayArea: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    width: "100%",
    maxWidth: "600px",
    backgroundColor: "rgba(10, 10, 10, 0.55)",
    borderRadius: "8px",
    padding: "0 16px",
  },
  bvFocalGuide: {
    display: "flex",
    alignItems: "center",
    width: "100%",
    justifyContent: "center",
  },
  bvFocalLine: {
    flex: 1,
    height: "1px",
    backgroundColor: "rgb(45, 45, 45)",
    maxWidth: "120px",
  },
  bvFocalMarker: {
    width: "1px",
    height: "24px",
    backgroundColor: "rgb(45, 45, 45)",
  },
  bvWordContainer: {
    width: "100%",
    height: "80px",
    position: "relative",
    overflow: "visible",
  },
  bvWordDisplay: {
    position: "absolute",
    top: "50%",
    left: "50%",
    fontSize: "2.5rem",
    fontWeight: "500",
    whiteSpace: "nowrap",
    display: "flex",
    alignItems: "center",
  },

  // iOS install banner
  iosBanner: {
    position: "fixed",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#1a1a1a",
    borderTop: "1px solid #333",
    padding: "12px 16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    zIndex: 1000,
  },
  iosBannerContent: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    color: "#999",
    fontSize: "0.8rem",
  },
  iosBannerClose: {
    background: "transparent",
    border: "none",
    color: "#666",
    cursor: "pointer",
    padding: "4px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
};

export default App;
