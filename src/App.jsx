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
  Eye,
  EyeOff,
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

// IndexedDB helpers for large data (book text)
const DB_NAME = "rsvp-reader";
const DB_STORE = "data";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

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
    if (saved) {
      const parsed = JSON.parse(saved);
      // Migrate: move text from localStorage to IndexedDB
      if (parsed.text) {
        idbSet("text", parsed.text).catch(() => {});
        const { text, ...rest } = parsed;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
      }
      return parsed;
    }
  } catch (e) {
    console.error("Failed to load settings:", e);
  }
  return null;
}

function saveSettings(settings) {
  try {
    // Store text and position in IndexedDB, small settings in localStorage
    const { text, currentIndex, ...rest } = settings;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
    idbSet("text", text).catch(() => {});
    idbSet("position", currentIndex).catch(() => {});
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

// Word indices where sentences start (0 is always first sentence)
function getSentenceStarts(words) {
  const starts = [0];
  for (let i = 0; i < words.length - 1; i++) {
    if (/[.!?]["')\]]?$/.test(words[i])) starts.push(i + 1);
  }
  return starts;
}

// Resolve URL hash params (pos=N or sentence=N) to a word index
function resolveHashIndex(hashStr, words) {
  if (!hashStr) return null;
  const params = new URLSearchParams(hashStr.replace(/^#/, ""));
  const sentenceParam = params.get("sentence");
  if (sentenceParam != null) {
    const n = parseInt(sentenceParam, 10);
    if (!isNaN(n) && n >= 1) {
      const starts = getSentenceStarts(words);
      const idx = starts[Math.min(n - 1, starts.length - 1)];
      return idx ?? 0;
    }
  }
  const posParam = params.get("pos");
  if (posParam != null) {
    const n = parseInt(posParam, 10);
    if (!isNaN(n) && n >= 0) return n;
  }
  return null;
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

const BookView = memo(function BookView({ words, currentIndex, sideOpacity, setCurrentIndex, setIsPlaying, paragraphBreaks, overlayHidden }) {
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
      const offset = containerH * 0.3 - markerTop - markerH / 2;
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
      className="bv-outer"
      onMouseDown={(e) => onDragStart(e.clientY)}
      onTouchStart={(e) => onDragStart(e.touches[0].clientY)}
    >
      {/* Background: continuous book text, dimmed */}
      <div ref={bgContainerRef} className="bv-bg">
        <div ref={bgTextRef} className="bv-bg-text">
          {bgPastText}
          {bgPastText ? (paragraphBreaks.has(currentIndex) ? "\n\n" : " ") : ""}
          <span ref={markerRef} className="bv-bg-active-word">{activeWord}</span>
          {paragraphBreaks.has(currentIndex + 1) ? "\n\n" : " "}
          {bgFutureText}
        </div>
      </div>

      {/* Foreground: ORP center display */}
      <div className="flex-spacer" />
      {!overlayHidden && (
        <div className="bv-center">
          <div className="bv-display-area">
            <div className="bv-focal-guide">
              <div className="bv-focal-line" />
              <div className="bv-focal-marker" />
              <div className="bv-focal-line" />
            </div>

            <div className="bv-word-container">
              <div
                style={{ transform: `translateY(-50%) translateX(calc(-${orpIdx}ch - 0.5ch))` }}
                className="bv-word-display mono"
              >
                <span className="before-orp" style={{ opacity: sideOpacity }}>
                  {before}
                </span>
                <span className="orp-char">{orp}</span>
                <span className="after-orp" style={{ opacity: sideOpacity }}>
                  {after}
                </span>
              </div>
            </div>

            <div className="bv-focal-guide">
              <div className="bv-focal-line" />
              <div className="bv-focal-marker" />
              <div className="bv-focal-line" />
            </div>
          </div>
        </div>
      )}
      <div className="flex-spacer" />
    </div>
  );
});

// Capture URL hash before any effects can modify it
const initialUrlHash = window.location.hash;

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

  // Load text and position from IndexedDB on mount
  const [idbLoaded, setIdbLoaded] = useState(false);
  useEffect(() => {
    Promise.all([idbGet("text"), idbGet("position")]).then(([savedText, savedPos]) => {
      if (savedText && savedText !== DEFAULT_TEXT) {
        setText(savedText);
        const parsed = parseText(savedText);
        setWords(parsed.words);
        setParagraphBreaks(parsed.breaks);
        // Restore position: URL hash (captured before effects) > IndexedDB > 0
        let pos = resolveHashIndex(initialUrlHash, parsed.words);
        if (pos == null) pos = typeof savedPos === "number" ? savedPos : 0;
        const clamped = Math.min(Math.max(0, pos), Math.max(0, parsed.words.length - 1));
        _setCurrentIndex(clamped);
      }
      setIdbLoaded(true);
    }).catch(() => setIdbLoaded(true));
  }, []);

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
  const [bookOverlayHidden, setBookOverlayHidden] = useState(
    () => savedSettings?.bookOverlayHidden ?? false,
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



  // Save position for current text (lightweight, every word change)
  useEffect(() => {
    if (!idbLoaded) return;
    positionsRef.current = savePositionForText(
      text,
      currentIndex,
      positionsRef.current,
    );
    try { localStorage.setItem("rsvp-current-index", String(currentIndex)); } catch {}
  }, [text, currentIndex, idbLoaded]);

  // Save full settings when settings/text change or playback stops
  useEffect(() => {
    if (!idbLoaded || isPlaying) return;
    saveSettings({
      wpm,
      text,
      currentIndex,
      positions: positionsRef.current,
      sideOpacity,
      bookView,
      bookOverlayHidden,
      bookMetadata,
      fetchMetadataOnline,
    });
  }, [wpm, text, isPlaying, sideOpacity, bookView, bookOverlayHidden, bookMetadata, fetchMetadataOnline, idbLoaded]);

  // Save full settings when page unloads or goes to background (iOS)
  // Save full settings when page unloads or goes to background (iOS)
  useEffect(() => {
    if (!idbLoaded) return;
    const save = () => {
      saveSettings({
        wpm,
        text,
        currentIndex,
        positions: positionsRef.current,
        sideOpacity,
        bookView,
        bookOverlayHidden,
        bookMetadata,
        fetchMetadataOnline,
      });
    };
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") save();
    };
    window.addEventListener("beforeunload", save);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("beforeunload", save);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [wpm, text, currentIndex, sideOpacity, bookView, bookOverlayHidden, bookMetadata, fetchMetadataOnline, idbLoaded]);

  // Update URL hash with current position in real time
  useEffect(() => {
    if (idbLoaded && words.length > 0) {
      window.history.replaceState(null, "", `${window.location.pathname}#pos=${currentIndex}`);
    }
  }, [currentIndex, words.length, idbLoaded]);

  // React to manual URL hash changes (jump by typing #pos=N or #sentence=N)
  useEffect(() => {
    if (!idbLoaded || words.length === 0) return;
    const onHashChange = () => {
      const target = resolveHashIndex(window.location.hash, words);
      if (target == null) return;
      const clamped = Math.min(Math.max(0, target), words.length - 1);
      if (clamped !== currentIndex) {
        setIsPlaying(false);
        _setCurrentIndex(clamped);
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [idbLoaded, words, currentIndex]);

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
    <div className="container">
      {/* Top controls */}
      <div className="top-bar">
        <div className="top-left">
          <button
            onClick={() => setShowTextInput(!showTextInput)}
            className={`text-btn icon-btn${showTextInput ? " active" : ""}`}
            title="Edit text"
          >
            <FileText size={16} />
            <span className="text-btn-label">Text</span>
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-btn icon-btn"
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
            className="hidden"
          />
          {isFullscreenSupported() && (
            <button
              onClick={toggleFullscreen}
              className="text-btn icon-btn"
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
            </button>
          )}
        </div>
        <div className="top-center">
          <div className="wpm-control">
            <button
              onClick={() => adjustWpm(-25)}
              className="wpm-btn"
            >
              <Minus size={16} />
            </button>
            <div className="wpm-display">
              <span className="wpm-value">
                {wpm}
              </span>
              <span className="wpm-label">WPM</span>
            </div>
            <button
              onClick={() => adjustWpm(25)}
              className="wpm-btn"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>
        <div className="top-right">
          <button
            onClick={() => setBookView(!bookView)}
            className={`icon-btn${bookView ? " active" : ""}`}
            title="Book view"
          >
            <BookOpen size={18} />
          </button>
          {bookView && (
            <button
              onClick={() => setBookOverlayHidden((v) => !v)}
              className={`icon-btn${bookOverlayHidden ? " active" : ""}`}
              title={bookOverlayHidden ? "Show focus word" : "Hide focus word"}
            >
              {bookOverlayHidden ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          )}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="icon-btn"
            title="Settings"
          >
            <Settings size={18} />
          </button>
          <button
            onClick={() => setShowShortcuts(!showShortcuts)}
            className="icon-btn"
            title="Keyboard shortcuts"
          >
            <Keyboard size={18} />
          </button>
          <button
            onClick={() => setShowInfo(!showInfo)}
            className="icon-btn"
            title="How it works"
          >
            <Info size={18} />
          </button>
        </div>
      </div>

      {/* Text input panel - fixed position overlay */}
      {showTextInput && (
        <div className="text-input-overlay">
          <div className="text-input-panel">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="textarea"
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
          overlayHidden={bookOverlayHidden}
        />
      ) : (
        <div className="main-area">
          <div className="display-area">
            <div className="focal-guide">
              <div className="focal-line" />
              <div className="focal-marker" />
              <div className="focal-line" />
            </div>

            <div className="word-container">
              {currentText ? (
                <div
                  style={{ transform: `translateY(-50%) translateX(calc(-${orpIndex}ch - 0.5ch))` }}
                  className="mono word-display"
                >
                  <span className="before-orp" style={{ opacity: sideOpacity }}>
                    {beforeORP}
                  </span>
                  <span className="orp-char">{orpChar}</span>
                  <span className="after-orp" style={{ opacity: sideOpacity }}>
                    {afterORP}
                  </span>
                </div>
              ) : (
                <div
                  style={{ transform: "translateY(-50%) translateX(-50%)" }}
                  className="mono word-display"
                >
                  <span className="placeholder">Ready</span>
                </div>
              )}
            </div>

            <div className="focal-guide">
              <div className="focal-line" />
              <div className="focal-marker" />
              <div className="focal-line" />
            </div>
          </div>
        </div>
      )}

      {/* Bottom controls */}
      <div className="bottom-area">
        {/* Controls with play button in center */}
        <div className="controls-row">
          <button
            onClick={() => stepWord(-10)}
            className="skip-btn"
            title="Back 10 words"
          >
            <ChevronLeft size={24} />
            <ChevronLeft size={24} className="chevron-overlap" />
          </button>
          <button onClick={togglePlay} className="play-btn">
            {isPlaying ? <PauseSolid size={32} /> : <PlaySolid size={32} />}
          </button>
          <button
            onClick={() => stepWord(10)}
            className="skip-btn"
            title="Forward 10 words"
          >
            <ChevronRight size={24} />
            <ChevronRight size={24} className="chevron-overlap" />
          </button>
        </div>

        {/* Progress */}
        <div
          className="progress-container"
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
          <div className="progress-bar" style={{ width: `${progress}%` }} />
        </div>
        <div className="progress-row">
          <div className="progress-text">
            {currentIndex + 1} / {words.length} ({Math.round(progress)}%)
          </div>
          <button
            onClick={copyPositionUrl}
            className="link-btn icon-btn"
            title="Copy link to current position"
          >
            {linkCopied ? <Check size={14} /> : <Link size={14} />}
            <span className="link-btn-text">{linkCopied ? "Copied" : "Copy link"}</span>
          </button>
        </div>

        <div className="hint">
          <kbd className="kbd">Space</kbd> play
          <kbd className="kbd">←</kbd>
          <kbd className="kbd">→</kbd> word
          <kbd className="kbd">↑</kbd>
          <kbd className="kbd">↓</kbd> speed
          <kbd className="kbd">R</kbd> reset
          <kbd className="kbd">B</kbd> book
        </div>

        {/* Book metadata display */}
        {bookMetadata && (bookMetadata.title || bookMetadata.cover) && (
          <aside aria-label="Current book" className="book-metadata">
            {bookMetadata.cover && (
              <img
                src={bookMetadata.cover}
                alt={`Cover of ${bookMetadata.title || "current book"}`}
                className="book-cover"
              />
            )}
            <div className="book-info">
              {bookMetadata.title && (
                <h3 className="book-title">{bookMetadata.title}</h3>
              )}
              {bookMetadata.author && (
                <p className="book-author">{bookMetadata.author}</p>
              )}
              <p className="book-stats">
                {formatReadingTime((words.length - currentIndex) / wpm)} left
              </p>
            </div>
          </aside>
        )}
      </div>

      {/* Keyboard shortcuts modal */}
      {showShortcuts && (
        <div
          className="modal-overlay"
          onClick={() => setShowShortcuts(false)}
          role="presentation"
        >
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortcuts-title"
          >
            <div className="modal-header">
              <h2 id="shortcuts-title" className="modal-title">Keyboard shortcuts</h2>
              <button
                onClick={() => setShowShortcuts(false)}
                className="close-btn"
              >
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="shortcut-list">
                <div className="shortcut-row">
                  <kbd className="kbd-large">Space</kbd>
                  <span>Play / Pause</span>
                </div>
                <div className="shortcut-row">
                  <kbd className="kbd-large">←</kbd>
                  <span>Previous word</span>
                </div>
                <div className="shortcut-row">
                  <kbd className="kbd-large">→</kbd>
                  <span>Next word</span>
                </div>
                <div className="shortcut-row">
                  <kbd className="kbd-large">Shift + ←</kbd>
                  <span>Back 10 words</span>
                </div>
                <div className="shortcut-row">
                  <kbd className="kbd-large">Shift + →</kbd>
                  <span>Forward 10 words</span>
                </div>
                <div className="shortcut-row">
                  <kbd className="kbd-large">↑</kbd>
                  <span>Increase speed</span>
                </div>
                <div className="shortcut-row">
                  <kbd className="kbd-large">↓</kbd>
                  <span>Decrease speed</span>
                </div>
                <div className="shortcut-row">
                  <kbd className="kbd-large">R</kbd>
                  <span>Reset to beginning</span>
                </div>
                <div className="shortcut-row">
                  <kbd className="kbd-large">B</kbd>
                  <span>Toggle book view</span>
                </div>
                <div className="shortcut-row">
                  <kbd className="kbd-large">Esc</kbd>
                  <span>Close dialogs</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* How it works modal */}
      {showInfo && (
        <div className="modal-overlay" onClick={() => setShowInfo(false)} role="presentation">
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="info-title"
          >
            <div className="modal-header">
              <h2 id="info-title" className="modal-title">How RSVP speed reading works</h2>
              <button
                onClick={() => setShowInfo(false)}
                className="close-btn"
              >
                <X size={20} />
              </button>
            </div>
            <div className="modal-content">
              <h3 className="section-title">The science</h3>
              <p className="paragraph">
                <a
                  href="https://en.wikipedia.org/wiki/Rapid_serial_visual_presentation"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link"
                >
                  RSVP (Rapid Serial Visual Presentation)
                </a>{" "}
                displays text one word at a time at a fixed focal point. This
                eliminates eye movements (
                <a
                  href="https://en.wikipedia.org/wiki/Saccade"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link"
                >
                  saccades
                </a>
                ) that normally slow down reading — your eyes make 3-4 saccades
                per second during normal reading, each taking 20-30ms.
              </p>

              <h3 className="section-title">
                Optimal Recognition Point (ORP)
              </h3>
              <p className="paragraph">
                Research on the{" "}
                <a
                  href="https://en.wikipedia.org/wiki/Optimal_viewing_position"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link"
                >
                  Optimal Viewing Position
                </a>{" "}
                shows that eyes naturally fixate slightly left of center when
                recognizing words — typically 20-35% from the beginning. The{" "}
                <span className="red-text">red letter</span> marks this
                point, staying fixed so your eyes never move.
              </p>

              <h3 className="section-title">Spritz ORP positioning</h3>
              <p className="paragraph">
                This reader uses the Spritz algorithm for ORP placement:
              </p>
              <ul className="list">
                <li>1 character: 1st letter</li>
                <li>2-5 characters: 2nd letter</li>
                <li>6-9 characters: 3rd letter</li>
                <li>10-13 characters: 4th letter</li>
                <li>14+ characters: 5th letter</li>
              </ul>

              <h3 className="section-title">Research findings</h3>
              <p className="paragraph">
                Studies show RSVP can achieve 500+ WPM, though comprehension may
                decrease above 350-400 WPM for complex texts. Best for light
                reading, skimming, and building speed gradually.
              </p>

              <h3 className="section-title">Tips</h3>
              <ul className="list">
                <li>Start at 250-300 WPM and gradually increase</li>
                <li>Focus on the red letter, let words come to you</li>
                <li>Take breaks to avoid eye fatigue</li>
              </ul>

              <h3 className="section-title">Source code</h3>
              <p className="paragraph">
                This project is open source and available on{" "}
                <a
                  href="https://github.com/ronilaukkarinen/speed-reader"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link"
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
        <div className="ios-banner">
          <div className="ios-banner-content">
            <Share size={16} className="flex-shrink-0" />
            <span>For fullscreen, tap Share then "Add to Home Screen"</span>
          </div>
          <button
            onClick={dismissIOSBanner}
            className="ios-banner-close"
            aria-label="Dismiss"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Settings modal */}
      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)} role="presentation">
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
          >
            <div className="modal-header">
              <h2 id="settings-title" className="modal-title">Settings</h2>
              <button
                onClick={() => setShowSettings(false)}
                className="close-btn"
              >
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="setting-row">
                <label className="setting-label">Side opacity</label>
                <div className="setting-control">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={sideOpacity * 100}
                    onChange={(e) => setSideOpacity(e.target.value / 100)}
                    className="slider"
                  />
                  <span className="setting-value">
                    {Math.round(sideOpacity * 100)}%
                  </span>
                </div>
              </div>
              <div className="setting-row">
                <label className="setting-label">
                  <span>Fetch missing metadata online</span>
                  <span className="setting-hint">Uses Open Library API</span>
                </label>
                <div className="setting-control">
                  <button
                    onClick={() => setFetchMetadataOnline(!fetchMetadataOnline)}
                    className="toggle-btn"
                    style={{ backgroundColor: fetchMetadataOnline ? "#ff6b6b" : "#333" }}
                    aria-pressed={fetchMetadataOnline}
                  >
                    <span
                      className="toggle-knob"
                      style={{ transform: fetchMetadataOnline ? "translateX(16px)" : "translateX(0)" }}
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


export default App;
