// === SECTION REGISTRY ===
// Single source of truth for all board sections (top to bottom)
// Matches BEHAVIOR-SPEC.md § 1. Terminology exactly

// The two info rows were dissolved (names moved under the hands, turn cues went
// to affordance highlights). Sections are now hand · play · middle · play · hand
// with 2 big + 2 small gaps between them.
// Each hand gets a name band directly outside it (flush — gapAfter null — so the
// name's own line-height provides the gap to the cards). The 4 big/small gaps
// between the main rows are unchanged.
const SECTION_REGISTRY = [
  { id: 'hand_opp_name',  heightKey: 'name_row',    gapAfter: null    },
  { id: 'hand_opp',       heightKey: 'hand_opp',    gapAfter: 'small' },
  { id: 'play_opp',       heightKey: 'play_row',    gapAfter: 'big'   },
  { id: 'middle-section', heightKey: 'discard_draw', gapAfter: 'big'   },
  { id: 'play_user',      heightKey: 'play_row',    gapAfter: 'small' },
  { id: 'hand_user',      heightKey: 'hand_user',   gapAfter: null    },
  { id: 'hand_user_name', heightKey: 'name_row',    gapAfter: null    },
];

// Apply heights and spacing to all sections
// Called from layout.js and rendering.js
function applySectionLayout(sectionHeights, bigGapPx, smallGapPx) {
  SECTION_REGISTRY.forEach(section => {
    const el = document.getElementById(section.id);
    if (!el) return;

    // Apply height
    const height = sectionHeights[section.heightKey];
    if (height !== undefined) {
      el.style.height = height + 'px';
    }

    // Apply spacing
    if (section.gapAfter === 'big') {
      el.style.marginBottom = bigGapPx + 'px';
    } else if (section.gapAfter === 'small') {
      el.style.marginBottom = smallGapPx + 'px';
    } else {
      el.style.marginBottom = '0';
    }
  });
}

// Get ordered list of section IDs (useful for z-index calculations)
function getSectionOrder() {
  return SECTION_REGISTRY.map(s => s.id);
}

// Get section config by ID
function getSection(id) {
  return SECTION_REGISTRY.find(s => s.id === id);
}
