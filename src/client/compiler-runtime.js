// The modules an installed template may import. Kept in its own lazily loaded
// module so the app's main bundle does not carry runtimes that only installed
// templates need.

import * as svelte from "svelte";
import * as animate from "svelte/animate";
import * as easing from "svelte/easing";
import * as internal from "svelte/internal/client";
import * as legacy from "svelte/legacy";
import * as motion from "svelte/motion";
import * as reactivity from "svelte/reactivity";
import * as store from "svelte/store";
import * as transition from "svelte/transition";

import * as topics from "../schemas/topics.js";

export const modules = {
  svelte,
  "svelte/animate": animate,
  "svelte/easing": easing,
  "svelte/internal/client": internal,
  "svelte/legacy": legacy,
  "svelte/motion": motion,
  "svelte/reactivity": reactivity,
  "svelte/store": store,
  "svelte/transition": transition,
  "markdownapps/schema/topics": topics,
};
