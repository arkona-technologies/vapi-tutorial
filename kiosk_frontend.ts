let cur_workspace: null | string = null;

function update_cur_workspace(new_ws: string | null) {
  console.log(`update_cur_workspace:`, new_ws);
  cur_workspace = new_ws;
  const el = document.querySelector("#cur-workspace");
  console.assert(!!el);
  console.log(el);
  (el as Element).textContent = `Current workspace directory: ${
    new_ws ?? "none"
  }`;
}

function i_section(id: string): number {
  if (id === "home") return -1;
  console.assert(id.startsWith("section-"));
  return parseInt(id.replace("section-", ""));
}

function get_sections() {
  const result: Element[] = [];
  document.querySelectorAll(".button").forEach((el) => {
    if (el.id.startsWith("section-")) result.push(el);
  });
  return result.sort((a, b) => i_section(a.id) - i_section(b.id));
}

function show_section_description(
  i: number /* show "home screen" iff i === -1 */
) {
  const sections = get_sections();
  const num_sections = 1 /* explainer */ + sections.length;
  const base_left_overhang_vw = ((num_sections - 1) * 100) / 2;
  const target_vw =
    base_left_overhang_vw /* centered by default, this shifts part #0 to left: 0 */ -
    100 * (i + 1); /* 'home screen' */
  for (const el of sections) {
    if (i_section(el.id) === i) {
      el.classList.add("active");
    } else {
      el.classList.remove("active");
    }
  }
  const carousel = document.querySelector("#carousel");
  console.assert(!!carousel);
  carousel?.setAttribute("style", `transform: translate(${target_vw}vw, 0);`);
}

const DEFAULT_TIMEOUT_MS = 10000; // might even take longer than this if we're rsyncing?

async function request_with_timeout(
  relative_url: string,
  timeout_ms?: number
): Promise<null | Response> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    timeout_ms ?? DEFAULT_TIMEOUT_MS
  );
  const t0 = new Date();
  try {
    const result = await fetch(
      window.location.toString().replace(/\/[^\/]+$/, "/") + relative_url,
      {
        signal: controller.signal,
      }
    );
    console.log(`Took ${new Date().valueOf() - t0.valueOf()} ms`);
    clearTimeout(timeout);
    return result;
  } catch (e) {
    console.log(`Error while trying to open ${relative_url}: ${e}`);
  } finally { clearTimeout(timeout); }
  return null;
}

async function request_workspace(what: "wipe" | "fresh" | "get") {
  const maybe_response = await request_with_timeout(
    `${what}-workspace`,
    what === "get" ? 1000 : DEFAULT_TIMEOUT_MS
  );
  if (maybe_response) {
    update_cur_workspace((await maybe_response.json()).workspace);
  }
}

document.onreadystatechange = () => request_workspace("get");

async function request_section(calling_element: HTMLElement) {
  const section_identifier = calling_element.id; // section-n or home
  console.log("requested", section_identifier);
  const requested_section = section_identifier;
  const i = i_section(requested_section);
  const successful = await (async () => {
    if (i < 0) return true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    const t0 = new Date();
    // TODO: might take much longer if we first have to rsync a fresh workspace behind the scenes?
    const maybe_result = await request_with_timeout(requested_section, 1000);
    if (maybe_result !== null) {
      console.log((await maybe_result.json()).workspace);
    }
    console.log(`Request consumed ${new Date().valueOf() - t0.valueOf()} ms`);
    clearTimeout(timeout);
    return !!maybe_result;
  })();
  if (successful) {
    show_section_description(i_section(requested_section));
  } else {
    console.log(`Unable to open section '${requested_section}'`);
  }
}
