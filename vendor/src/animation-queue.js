// animation-queue.js — Prerequisites/queueing system for coordinated animations. Layer 4 (UI).
// Ensures animations happen in correct order with proper dependencies and timing.

class AnimationQueue {
  constructor() {
    this.queue = [];
    this.running = false;
    this.currentAnimation = null;
    this.prerequisites = new Map(); // animationId -> Set of prerequisite IDs
  }

  // Add animation with optional prerequisites
  enqueue(animation) {
    const animationWithId = {
      id: animation.id || this.generateId(),
      type: animation.type,
      target: animation.target,
      duration: animation.duration || CONFIG.ui.animMs,
      execute: animation.execute,
      prerequisites: animation.prerequisites || [],
      priority: animation.priority || 0,
      timestamp: Date.now()
    };

    this.queue.push(animationWithId);
    
    // Store prerequisites for dependency tracking
    if (animationWithId.prerequisites.length > 0) {
      this.prerequisites.set(animationWithId.id, new Set(animationWithId.prerequisites));
    }

    this.processQueue();
    return animationWithId.id;
  }

  // Process queue, respecting prerequisites and priorities
  async processQueue() {
    if (this.running) return;
    this.running = true;

    while (this.queue.length > 0) {
      const readyAnimations = this.queue.filter(anim => this.canRun(anim));
      
      if (readyAnimations.length === 0) {
        // No animations can run (waiting for prerequisites)
        // This could happen if prerequisites are external
        break;
      }

      // Sort by priority (higher first), then by timestamp (earlier first)
      readyAnimations.sort((a, b) => {
        if (a.priority !== b.priority) return b.priority - a.priority;
        return a.timestamp - b.timestamp;
      });

      const nextAnimation = readyAnimations[0];
      await this.runAnimation(nextAnimation);
    }

    this.running = false;
  }

  // Check if animation can run (all prerequisites completed)
  canRun(animation) {
    const prereqs = this.prerequisites.get(animation.id);
    if (!prereqs || prereqs.size === 0) return true;

    // Check if any prerequisites are still in queue (not completed)
    for (const prereqId of prereqs) {
      if (this.queue.some(anim => anim.id === prereqId)) {
        return false; // Prerequisite still pending
      }
    }
    return true; // All prerequisites completed
  }

  // Execute animation and remove from queue
  async runAnimation(animation) {
    this.currentAnimation = animation;
    
    try {
      await animation.execute();
      
      // Wait for animation duration
      await this.delay(animation.duration);
      
    } catch (error) {
      console.warn(`Animation ${animation.id} failed:`, error);
    }

    // Remove completed animation from queue and prerequisites
    this.queue = this.queue.filter(anim => anim.id !== animation.id);
    this.prerequisites.delete(animation.id);
    
    // Remove this animation as prerequisite from others
    for (const [animId, prereqs] of this.prerequisites.entries()) {
      prereqs.delete(animation.id);
      if (prereqs.size === 0) {
        this.prerequisites.delete(animId);
      }
    }

    this.currentAnimation = null;
    
    // Emit completion event for external dependencies
    emit('animationComplete', { animationId: animation.id, type: animation.type });
  }

  // Mark external prerequisite as complete
  markPrerequisiteComplete(prerequisiteId) {
    for (const [animId, prereqs] of this.prerequisites.entries()) {
      prereqs.delete(prerequisiteId);
      if (prereqs.size === 0) {
        this.prerequisites.delete(animId);
      }
    }
    
    // Try to process queue again now that prerequisite is done
    this.processQueue();
  }

  // Common animation types with built-in coordination
  
  // Card movement: from -> to with optional intermediate positions
  animateCardMove(cardId, fromPos, toPos, options = {}) {
    return this.enqueue({
      id: options.id || `card-move-${cardId}-${Date.now()}`,
      type: 'card-move',
      target: cardId,
      duration: options.duration || CONFIG.ui.animMs,
      prerequisites: options.prerequisites || [],
      priority: options.priority || 1,
      execute: async () => {
        const element = document.querySelector(`[data-id="${cardId}"]`);
        if (!element) return;

        // Use four-corner renderer for card movements
        if (typeof fourCornerRenderer !== 'undefined') {
          const intermediatePositions = options.intermediate || [];
          
          for (const pos of intermediatePositions) {
            fourCornerRenderer.renderCard(cardId, pos, false);
            await this.delay(options.intermediateDelay || 100);
          }
          
          fourCornerRenderer.renderCard(cardId, toPos, false);
        } else {
          // Fallback to simple position animation
          // Bespoke card MOVEMENT (four-corner fallback); animMs speed is CONFIG single-source.
          element.style.transition = `all ${this.duration}ms var(--ease-inout)`;
          element.style.left = toPos.x + 'px';
          element.style.top = toPos.y + 'px';
        }
      }
    });
  }

  // Turn transition: coordinate multiple effects
  animateTurnTransition(newTurn, oldTurn, options = {}) {
    const baseId = `turn-transition-${Date.now()}`;
    
    // 1. Fade out old turn effects
    const fadeOutId = this.enqueue({
      id: `${baseId}-fadeout`,
      type: 'turn-fadeout',
      duration: 150,
      priority: 10,
      execute: async () => {
        // Screen edge glow + radial glow are driven by renderUIState in rendering.js now
      }
    });

    // 2. Show new turn effects (after fadeout)
    return this.enqueue({
      id: `${baseId}-fadein`,
      type: 'turn-fadein',  
      duration: CONFIG.ui.animMs,
      priority: 9,
      prerequisites: [fadeOutId],
      execute: async () => {
        turnNotificationSystem.onTurnChange(newTurn, gameState?.phase || 'play');
      }
    });
  }

  // Card play sequence: hand -> pile with feedback
  animateCardPlay(cardId, fromHand, toPile, options = {}) {
    const baseId = `card-play-${cardId}-${Date.now()}`;
    
    // 1. Lift card from hand
    const liftId = this.enqueue({
      id: `${baseId}-lift`,
      type: 'card-lift',
      duration: 100,
      priority: 5,
      execute: async () => {
        const element = document.querySelector(`[data-id="${cardId}"]`);
        if (element) {
          element.style.transform = (element.style.transform || '') + ' translateZ(10px)';
          element.style.filter = 'drop-shadow(0 4px 8px rgba(0,0,0,0.3))';
        }
      }
    });

    // 2. Move to pile (after lift)
    const moveId = this.animateCardMove(cardId, fromHand, toPile, {
      id: `${baseId}-move`,
      prerequisites: [liftId],
      priority: 4
    });

    // 3. Settle into pile (after move)
    return this.enqueue({
      id: `${baseId}-settle`,
      type: 'card-settle',
      duration: 100,
      prerequisites: [moveId],
      priority: 3,
      execute: async () => {
        const element = document.querySelector(`[data-id="${cardId}"]`);
        if (element) {
          element.style.transform = element.style.transform.replace(' translateZ(10px)', '');
          element.style.filter = 'none';
        }
        
        // Emit for sound/haptic feedback
        emit('cardSettled', { cardId, pile: toPile });
      }
    });
  }

  // Utility methods
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  generateId() {
    return `anim-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  }

  // Clear all pending animations
  clear() {
    this.queue = [];
    this.prerequisites.clear();
    this.running = false;
    this.currentAnimation = null;
  }

  // Get queue status for debugging
  getStatus() {
    return {
      queueLength: this.queue.length,
      running: this.running,
      currentAnimation: this.currentAnimation?.id,
      prerequisites: Array.from(this.prerequisites.entries()).map(([id, prereqs]) => ({
        id,
        waitingFor: Array.from(prereqs)
      }))
    };
  }
}

// Global instance
const animationQueue = new AnimationQueue();

// Integrate with existing systems
on('turnChanged', (data) => {
  // Use coordinated turn transition instead of immediate
  const oldTurn = gameState?.currentTurn;
  if (oldTurn && oldTurn !== data.newTurn) {
    animationQueue.animateTurnTransition(data.newTurn, oldTurn);
  }
});

on('cardPlayed', (data) => {
  // Could add coordinated card play animations here
  // For now, let existing system handle it
});

// Clean up on game over
on('gameOver', () => {
  animationQueue.clear();
});

// === UNIVERSAL PREREQUISITE CHECKER ===
// DRY function that all actions should use to check animation prerequisites

function checkActionPrerequisites(actionType, actionId = null) {
  // If no animation queue exists, prerequisites are always met (graceful fallback)
  if (typeof animationQueue === 'undefined') {
    return { ready: true, reason: 'no-animation-system' };
  }
  
  // Get relevant prerequisite types for this action
  const prerequisiteTypes = getPrerequisiteTypesForAction(actionType);
  
  // Check if any required animations are still running
  for (const requiredType of prerequisiteTypes) {
    if (animationQueue.currentAnimation && animationQueue.currentAnimation.type === requiredType) {
      return {
        ready: false,
        reason: 'animation-running',
        blockingAnimation: {
          type: requiredType,
          id: animationQueue.currentAnimation.id,
          target: animationQueue.currentAnimation.target
        }
      };
    }
    
    // Check if required animations are queued
    const queuedAnimations = animationQueue.queue.filter(anim => anim.type === requiredType);
    if (queuedAnimations.length > 0) {
      return {
        ready: false,
        reason: 'animation-queued',
        blockingAnimation: {
          type: requiredType,
          id: queuedAnimations[0].id,
          target: queuedAnimations[0].target
        }
      };
    }
  }
  
  return { ready: true, reason: 'all-prerequisites-met' };
}

// Map action types to their prerequisite animation types
function getPrerequisiteTypesForAction(actionType) {
  const prerequisites = {
    'ghost-card-display': ['card-selection', 'card-move'],
    'phase-text-update': ['turn-transition'],
    'card-play': ['card-selection'],
    'card-discard': ['card-selection'],
    'card-draw': ['card-move'],
    'pile-expansion': [], // No prerequisites for pile expansion
    'undo-display': ['card-move']
  };
  
  return prerequisites[actionType] || [];
}

// Universal action gate - use this before any visual indication
function gateAction(actionType, actionCallback, actionId = null) {
  const check = checkActionPrerequisites(actionType, actionId);
  
  if (check.ready) {
    // Prerequisites met, execute immediately
    return actionCallback();
  } else {
    // Prerequisites not met, defer until ready
    const pollInterval = setInterval(() => {
      const recheckResult = checkActionPrerequisites(actionType, actionId);
      if (recheckResult.ready) {
        clearInterval(pollInterval);
        actionCallback();
      }
    }, 16); // Check every frame (~60fps)
    
    // Safety timeout to prevent infinite polling
    setTimeout(() => {
      clearInterval(pollInterval);
      console.warn(`Action ${actionType} timed out waiting for prerequisites`);
      actionCallback(); // Execute anyway after timeout
    }, 2000);
  }
}