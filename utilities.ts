import { Color, registerWindow, SVG } from "@svgdotjs/svg.js";
import * as fs from "fs";
import { createSVGWindow } from "svgdom";
import { AT1130, Video } from "vapi";
import { enforce } from "vscript";
import { BIDUtils, sh } from "vutil";
import { standard_info } from "vutil/video.js";
import { VAPI_BLADE } from "./globals.js";

export async function load_demo_content(
  vm: AT1130.Root,
  skip_prelude: boolean
): Promise<{
  vsg_colorbars: AT1130.VideoSignalGenerator.VSG;
  vsg_counters: AT1130.VideoSignalGenerator.VSG;
  testseq_player: AT1130.VideoPlayer.Player;
  blender_player: AT1130.VideoPlayer.Player;
}> {
  const standard: Video.Standard = "HD1080p50";
  console.log("load_demo_content");
  enforce(!!vm.video_signal_generator && !!vm.re_play && !!vm.genlock);
  // we'll set up 4 video sources in total:
  //
  // 1. Video signal generator #0, emitting a Colorbar100 pattern @ HD1080p50
  // 2. Video signal generator #1, emitting a Counters pattern @ HD1080p50
  // 3. A player instance holding a HD1080p50 clip made by the Blender Foundation
  // 4. A player instance holding a custom-made test sequence that we render on this PC
  //
  // 1 and 2 are trivial to set up:

  const genlock = vm.genlock.instances.row(0);
  const vsg_indices = {
    colorbars: 0,
    counters: 1,
  } as const;
  const player_indices = {
    blender: 0,
    testseq: 1,
  } as const;
  if (!skip_prelude) {
    // TODO: where do we store our reference bid file?
    const BID_FILENAME = "/Users/arkona/Public/excerpt_bbb_png_01_01_HD1080p50_713_frames.bid";
    const NUM_BLENDER_FRAMES = parseInt(
      BID_FILENAME.replace(/.*_([0-9]+)_frames.*/, "$1")
    );
    enforce((await genlock.lanes.video_f50_ish.read())?.state === "Calibrated");
    for (const [vsg_index, pattern] of [
      [vsg_indices.colorbars, "Colorbars100"],
      [vsg_indices.counters, "Counters"],
    ] as const) {
      const vsg = vm.video_signal_generator.instances.row(vsg_index);
      await vsg.standard.command.write("HD1080p50");
      await vsg.t_src.command.write(genlock.output);
      await vsg.pattern.write(pattern);
    }

    // for 3, we pre-converted the clip of our choice into a '.bid' file, a proprietary
    // but trivial file format that begins with a \0-terminated JSON header, and ends with an
    // arbitrary number of uncompressed, 10-bit baseband frames. vutil and vsk contain helper
    // methods to interconvert between .bid and common image file formats such as png or yuv10.
    //
    // Once we have a bid file, we upload that data to our blade using a standard HTTP PUT
    // request. Although node.js has native support for http requests, we'll shell out to curl
    // to demonstrate how to integrate blade//runner into a shell pipeline

    // create player, make sure it's large enough to hold our example clip:
    const player = await vm.re_play.video.players.create_row({
      index: player_indices.blender,
      allow_reuse_row: true,
    });
    await Promise.all([
      player.capabilities.add_blanking.command.write(false),
      player.capabilities.max_bandwidth.command.write("b3_0Gb"),
      player.capabilities.standard.command.write(standard),
      player.capabilities.capacity.command.write({
        variant: "Frames",
        value: { frames: NUM_BLENDER_FRAMES },
      }),
      player.output.time.t_src.command.write(genlock.output),
    ]);
    console.log(
      `Uploading blender sequence; this might take one or two minutes...`
    );
    await sh(
      `curl -T ${BID_FILENAME} 'http://${VAPI_BLADE}/replay/video?action=write&handler=${player_indices.blender}&store=clip_single_file'`
    );
  }

  // for 4, we'll pick some arbitrary sequence length, then create a perfect loop by
  // programmatically writing out SVG files, rasterizing them using Inkscape, and finally
  // converting and uploading the result as in step 3. For this example, we won't bother with
  // 10-bit color but use Inkscape's default 8-bits-per-channel output
  const SEQUENCE_LENGTH_FRAMES = 100; // ¯\_(ツ)_/¯
  const create_svg_frame = (frame_index: number) => {
    const pseudowindow = createSVGWindow() as any; /* :( */
    registerWindow(pseudowindow, pseudowindow.document);
    const std_info = standard_info(standard);
    const [width, height] = [std_info.width, std_info.height];
    const draw = SVG().size(width, height);
    // we'll start with a big blue plane,
    draw.rect(width, height).fill("#2a3b7d");
    // harmonically oscillates between +1 and -1
    const t_smooth = Math.sin(
      (2 * Math.PI * frame_index) / SEQUENCE_LENGTH_FRAMES
    );
    // linearly oscillates between 0 and 1 (triangle-shaped)
    const t_linear =
      1 - Math.abs((2 * frame_index) / SEQUENCE_LENGTH_FRAMES - 1);
    // followed by some colored stripes that slowly modulate their saturation over time.
    // Because, why not?
    const NUM_STRIPES = 11;
    const HOR_INSET = 120;
    const VERT_INSET = 120;
    const STRIPE_WIDTH = (width - 2 * HOR_INSET) / NUM_STRIPES;
    for (let i_stripe = 0; i_stripe < NUM_STRIPES; ++i_stripe) {
      const color = new Color(
        (360 * i_stripe) / NUM_STRIPES,
        80 + 20 * t_smooth,
        50,
        "hsl"
      );
      draw
        .rect(
          Math.ceil((width - 2 * HOR_INSET) / NUM_STRIPES),
          height - 2 * VERT_INSET
        )
        .translate(Math.floor(HOR_INSET + i_stripe * STRIPE_WIDTH), VERT_INSET)
        .fill(color);
    }
    // some white edges and a moving cross for good measure
    const [x_cross, y_cross] = [
      Math.round(HOR_INSET + t_linear * (width - 2 * HOR_INSET)),
      Math.round(VERT_INSET + t_linear * (height - 2 * VERT_INSET)),
    ];
    draw
      .line(x_cross, HOR_INSET, x_cross, height - HOR_INSET)
      .attr({ "stroke-width": "5px", stroke: "#ffffff" });
    draw
      .line(VERT_INSET, y_cross, width - VERT_INSET, y_cross)
      .attr({ "stroke-width": "5px", stroke: "#ffffff" });
    draw
      .rect(width - 2 * HOR_INSET, height - 2 * VERT_INSET)
      .translate(HOR_INSET, VERT_INSET)
      .attr({ "stroke-width": "5px", stroke: "#ffffff", fill: "none" });
    const INNER_DISTANCE = 40;
    draw
      .rect(
        width - 2 * (HOR_INSET + INNER_DISTANCE),
        height - 2 * (VERT_INSET + INNER_DISTANCE)
      )
      .translate(HOR_INSET + INNER_DISTANCE, VERT_INSET + INNER_DISTANCE)
      .attr({ "stroke-width": "5px", stroke: "#ffffff", fill: "none" });
    // and something that rotates
    draw.svg(
      `<filter id="dropShadow">
    <feGaussianBlur in="SourceAlpha" stdDeviation="8"/>
    <feOffset dx="0" dy="0" />
    <feMerge>
        <feMergeNode />
        <feMergeNode in="SourceGraphic" />
    </feMerge>
  </filter>`.trim()
    );
    const CIRCLE_RADIUS = 120;
    const CIRCLE_DIST_FROM_NORTHEAST = -64; // we'll overlap
    const [cx, cy] = [
      width -
        HOR_INSET -
        INNER_DISTANCE -
        CIRCLE_DIST_FROM_NORTHEAST -
        CIRCLE_RADIUS,
      VERT_INSET + INNER_DISTANCE + CIRCLE_DIST_FROM_NORTHEAST + CIRCLE_RADIUS,
    ];
    draw
      .circle(2 * CIRCLE_RADIUS)
      .translate(cx - CIRCLE_RADIUS, cy - CIRCLE_RADIUS)
      .attr({
        fill: "#484848",
        stroke: "#000000",
        "stroke-width": "4px",
        filter: "url(#dropShadow)",
      });
    // for (let step = 1; step < 10; ++step) {
    //   const radius = (CIRCLE_RADIUS * step) / 10;
    //   draw
    //     .circle(2 * radius)
    //     .translate(
    //       cx - radius + (CIRCLE_RADIUS - radius) / 2,
    //       cy - radius + (CIRCLE_RADIUS - radius) / 2
    //     )
    //     .attr({
    //       stroke: "rgba(255,255,255,0.6)",
    //       "stroke-width": "4px",
    //       filter: "url(#dropShadow)",
    //     });
    // }
    const theta = -(2 * Math.PI * frame_index) / SEQUENCE_LENGTH_FRAMES;
    draw
      .line(
        cx,
        cy,
        cx + 0.8 * CIRCLE_RADIUS * Math.sin(theta),
        cy + 0.8 * CIRCLE_RADIUS * Math.cos(theta)
      )
      .attr({ "stroke-width": 5, stroke: "#ffffff" });
    return draw.svg();
  };
  const tmp_dir = "/tmp/vapi-test-sequence";
  fs.mkdirSync(tmp_dir, { recursive: true });
  const svg_filenames: string[] = [];
  for (let i = 0; i < SEQUENCE_LENGTH_FRAMES; ++i) {
    const filename = `/tmp/vapi-test-sequence/test-sequence-${i}.svg`;
    fs.writeFileSync(filename, create_svg_frame(i));
    svg_filenames.push(filename);
  }
  console.log("Converting SVG sequence to single BID file...");
  // await sh(`display -density 40 ${svg_filenames[0]}`);
  const bids = await BIDUtils.svgs_to_bid(svg_filenames, {
    extract_alpha: false,
    standard,
    tmp_dir,
  });
  const seq_player = await vm.re_play.video.players.create_row({
    index: player_indices.testseq,
    allow_reuse_row: true,
  });
  await seq_player.output.time.t_src.command.write(genlock.output);
  // no need to set capabilities this time, upload_bid will either do that for us or fail
  console.log("Uploading bid file to test sequence player...");
  await BIDUtils.upload_bid(seq_player, bids.rgb);
  return {
    vsg_colorbars: vm.video_signal_generator.instances.row(
      vsg_indices.colorbars
    ),
    vsg_counters: vm.video_signal_generator.instances.row(vsg_indices.counters),
    blender_player: vm.re_play.video.players.row(player_indices.blender),
    testseq_player: vm.re_play.video.players.row(player_indices.testseq),
  };
}
