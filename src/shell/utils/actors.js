/**
 * @file actors.js
 * @module shell.utils.actors
 *
 * Provides focused actor-parenting operations shared by Shell UI components.
 *
 * Top bar components use this helper to preserve actor identity while
 * reconciling configured element order, avoiding repeated remove/insert logic.
 */

/**
 * Places an actor at an exact child index, reparenting it when necessary.
 *
 * @param {object} actor - Clutter actor to place.
 * @param {object} parent - Target actor container.
 * @param {number} index - Requested child index.
 * @returns {boolean} True when the actor was moved.
 */
export function placeActorAtIndex(actor, parent, index) {
  const currentParent = actor.get_parent();
  const currentIndex =
    currentParent === parent ? parent.get_children().indexOf(actor) : -1;
  if (currentIndex === index) return false;

  currentParent?.remove_child(actor);
  parent.insert_child_at_index(actor, index);
  return true;
}
