### 2026-04-25: 1.3.0

* Jump to word position by changing URL hash to `#pos=N`
* Jump to sentence by changing URL hash to `#sentence=N`
* Add eye toggle to show or hide focus word overlay in book view

### 2026-03-28: 1.2.0

* Store book text in IndexedDB to fix localStorage quota exceeded on iOS
* Save full settings only on pause and page unload instead of every word
* Add visibilitychange handler for reliable saves on iOS background

### 2026-03-14: 1.1.1

* Move book view background active word to upper area instead of center
* Increase display area opacity and add backdrop blur in book view
* Remove max-width constraint from book view display area
* Add soft feathered edges to book view ORP overlay
* Fix version extraction in release workflow

### 2026-03-08: 1.1.0

* Add book view mode with text flowing around a fixed center word
* Remove words per display setting, default to single word
* Save and restore reading position on refresh via localStorage
* Update URL hash with current position in real time
* Add drag to scrub through words in book view
* Fix position restore on page refresh
* Use justified text with automatic hyphens in book view
* Preserve paragraph breaks from epub files in book view
* Fix R keyboard shortcut resetting position on browser refresh
* Add dimmed book text background behind centered word in book view
* Highlight active word in book background with red glow and bold
* Fix paragraph break flicker in book view background text
* Improve focal guide line visibility in book view
* Refactor all inline styles to CSS classes

### 2026-02-02: 1.0.5

* Add fullscreen button for desktop browsers
* Add PWA support with manifest for standalone mode
* Add iOS install banner prompting Add to Home Screen for fullscreen experience

### 2026-02-01: 1.0.4

* Improve mobile responsiveness and book metadata layout
* Fix words per display setting and limit max to 3
* Add copy link button to share reading position across devices

### 2026-02-01: 1.0.3

* Add mobile responsiveness
* Fix modal accessibility
* Fix progress bar accessibility
* Add Open Library API integration for missing book metadata (opt-in)

### 2026-02-01: 1.0.2

* Convert book metadata to semantic HTML for accessibility
* Add reading time to book metadata display
* Improve book info readability

### 2026-02-01: 1.0.1

* Persist book metadata to localStorage

### 2026-02-01: 1.0.0

* Add dark/light mode support to favicon
* Change app title to sentence case
* Open CHANGELOG.md
* Release v1.0.0
