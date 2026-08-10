/**
 * @file actors.js
 * @module shell.utils.actors
 *
 * Provides focused actor-parenting operations shared by Shell UI components.
 *
 * Shell UI components use these helpers to preserve actor identity while
 * reconciling semantic order, avoiding repeated remove/insert implementations.
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

/**
 * Reconciles a filtered actor sequence into exact contiguous order.
 *
 * Renderers provide actors in semantic order and may include null entries for
 * controls that are currently hidden. Existing actors are reparented in place.
 *
 * @param {object} parent - Target actor container.
 * @param {Array<object|null|undefined>} orderedActors - Actors in desired order.
 */
export function reconcileActorOrder(parent, orderedActors) {
  let targetIndex = 0;
  for (const actor of orderedActors) {
    if (!actor) continue;
    placeActorAtIndex(actor, parent, targetIndex++);
  }
}
