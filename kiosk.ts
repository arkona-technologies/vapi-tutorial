import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { enforce } from "vscript";
import { sh } from "vutil";

const static_asset_map: Map<string, [type: string, body: string]> = new Map();

const preload_static_assets = false;

for (const static_asset of fs.readdirSync("./kiosk-assets")) {
  const route = "/" + static_asset;
  console.log(route);
  const ext = static_asset.split(".").slice(-1)[0];
  const content_type = (() => {
    switch (ext) {
      case "html":
        return "text/html";
      case "js":
        return "text/javascript";
      case "svg":
        return "image/svg+xml";
      case "png":
        return "image/png";
      case "map":
        return "source-map";
      default:
        console.log(`Encountered unsupported extension ${ext}`);
        return "todo";

    }
  })();
  static_asset_map.set(route, [
    content_type,
    fs.readFileSync(path.join("kiosk-assets", static_asset), "utf-8"),
  ]);
}

const USER_WORKSPACES = "/tmp/user-workspaces";

let cur_workspace = ((): string | null => {
  if (!fs.existsSync(USER_WORKSPACES)) return null;
  const dir_entries_with_age: Array<[name: string, birthtimeMs: number]> = [];
  for (const filename of fs.readdirSync(USER_WORKSPACES)) {
    if (!filename.startsWith("vapi_workspace_")) continue;
    try {
      const info = fs.statSync(path.join(USER_WORKSPACES, filename));
      if (info.isDirectory())
        dir_entries_with_age.push([filename, info.birthtimeMs]);
    } catch (e) {
      console.log(`Unable to stat ${filename}: ${e}`);
    }
  }
  dir_entries_with_age.sort((a, b) => b[1] - a[1]);
  console.log(dir_entries_with_age);
  if (dir_entries_with_age.length > 0) return dir_entries_with_age[0][0];
  return null;
})();

console.log(`cur_workspace: ${cur_workspace}`);

try {
  if (cur_workspace === null) await create_fresh_workspace();
} catch (e) {
  console.log(`Unable to create fresh workspace: ${e}`);
}

function wipe_workspace() {
  console.log("wipe_workspace");
  if (cur_workspace) {
    try {
      fs.rmSync(path.join(USER_WORKSPACES, cur_workspace), { recursive: true });
    } catch (e) {
      console.log(`Error while trying to wipe workspace: ${e}`);
    } finally {
      cur_workspace = null;
    }
  }
  cur_workspace = null;
}

async function create_fresh_workspace() {
  const TEMPLATE = path.resolve(".");
  console.log("create_fresh_workspace");
  const next_counter = (() => {
    if (cur_workspace === null) return 0;
    const int_part = cur_workspace.replace(/^.*_([0-9]+)$/, "$1");
    return parseInt(int_part, 10) + 1;
  })();
  fs.mkdirSync(USER_WORKSPACES, { recursive: true });
  const next_workspace = `vapi_workspace_${next_counter}`;
  const ws_full = path.join(USER_WORKSPACES, next_workspace);
  if (fs.existsSync(ws_full)) fs.rmSync(ws_full, { recursive: true });
  await sh(`rsync --exclude node_modules -avzh ${TEMPLATE}/ '${ws_full}'`);
  await sh(`ln -s '${TEMPLATE}/node_modules' '${ws_full}/node_modules'`);
  cur_workspace = next_workspace;
}

let request_pending = false;

const PATH_TO_VISUAL_STUDIO_CODE = "code";
const PORT = 4000;

async function dispatch_request(
  relative_url: string,
  res: http.ServerResponse
) {
  if (request_pending) {
    res.writeHead(503);
    // TODO: don't cache, set retry interval?
    res.end();
    return;
  }
  request_pending = true;
  try {
    const show_file = async (filename: string) => {
      if (
        cur_workspace === null ||
        !fs.existsSync(path.join(USER_WORKSPACES, cur_workspace, filename))
      ) {
        await create_fresh_workspace();
      }
      enforce(!!cur_workspace);
      if (PATH_TO_VISUAL_STUDIO_CODE.length > 0) {
        await sh(
          `${PATH_TO_VISUAL_STUDIO_CODE} --reuse-window --add '${path.join(
            USER_WORKSPACES,
            cur_workspace
          )}'`
        );
        await sh(
          `${PATH_TO_VISUAL_STUDIO_CODE} --reuse-window --goto '${path.join(
            USER_WORKSPACES,
            cur_workspace,
            filename
          )}'`
        );
      }
    };
    switch (relative_url.replace(/^\/+/, "")) {
      case "section-0":
        await show_file("0_first_steps.ts");
        break;
      case "section-1":
        await show_file("1_basic_monitoring.ts");
        break;
      case "section-2":
        await show_file("2_test_sequences.ts");
        break;
      case "section-3":
        await show_file("3_basic_control.ts");
        break;
      case "fresh-workspace":
        await create_fresh_workspace();
        break;
      case "get-workspace":
        break;
      case "wipe-workspace":
        wipe_workspace();
    }
    console.log("cur_workspace:", cur_workspace);
    res.writeHead(200);
    console.log(
      "response:",
      JSON.stringify(
        {
          workspace: cur_workspace
            ? path.join(USER_WORKSPACES, cur_workspace)
            : null,
        },
        null,
        2
      )
    );
    res.end(
      JSON.stringify(
        {
          workspace: cur_workspace
            ? path.join(USER_WORKSPACES, cur_workspace)
            : null,
        },
        null,
        2
      )
    );
  } catch (e) {
    console.log(e);
    res.writeHead(500, `Got error: ${JSON.stringify(`${e}`)}`);
    res.end();
  } finally {
    request_pending = false;
  }
}

const server = http.createServer((req, res) => {
  console.log(req.method);
  if (req.method === "GET") {
    let relative_url = req.url ?? "";
    if (relative_url === "/") relative_url = "/kiosk.html";
    console.log(relative_url);
    const maybe_static_asset_entry = static_asset_map.get(relative_url);
    if (maybe_static_asset_entry) {
      console.log("found entry:");
      res.setHeader("Content-Type", maybe_static_asset_entry[0]);
      res.writeHead(200);
      res.end(
        preload_static_assets
          ? maybe_static_asset_entry[1]
          : fs.readFileSync(path.join("kiosk-assets", relative_url))
      );
      return;
    }
    console.log(`relative_url: ${relative_url}`);
    dispatch_request(relative_url, res);
  }
});
// https://apple.stackexchange.com/questions/273896/using-chrome-on-macos-without-address-bar-menu-like-kiosk-mode
// open -a Google\ Chrome --args --kiosk http://www.yoursite.com/ --host-rules="MAP * www.yoursite.com"
server.listen(PORT, "localhost", () => console.log(`Server is running`));
