# Websocket Native Command Interface

The native command interface of the C100/AT300 uses JSON messages via Websocket (`/socket`). When establishing a new WebSocket connection, the webserver transmits one metadata message `{ "webserver_buildinfo": { "date": <string>, "time": <string> }, "protocol_features": <object> }`. Whereas `webserver_buildinfo` can safely be ignored, `protocol_features` indicates support for API features that may be missing in older software versions and thus should always be parsed during initialization. For sufficiently old software versions, the `protocol_features` field will be missing entirely, implying `protocol_features[x] = false` for all `x`.

## Sending commands to C100/AT300

Each command is a JSON object containing at least the field `op` which contains the opcode to execute. The following opcodes are currently defined:

- `marker`
  Inserts a marker in the command stream which can be used to get a feedback after all previously issued commands have been executed.
  The marker is a 15 bit number (0 ... 32767) which must be specified in the field `marker` with bit 15 set.

  Example: `{"op": "marker", "marker": 32769}` will request a marker `1` to be sent back.

- `data`
  Basic data changing command which can change one or more keywords inside one keyword list. The following fields are required:

  - `kwl`
    The keyword list name
  - `kw`
    A JSON object where the field names are the keyword names.
    More than one keyword can be set in a single command.

  Example: `{"op": "data", "kwl": "p_t_p_clock", "kw": {"mode": "UseInternalOscillator"}}`

  When the target keyword is a fixed length array the parameter must be a JSON object of the same length or a partial update.

  To update only some array elements send an JSON object (instead of an JSON array) where the key is the array index to update:

  Example: `{"op": "data", "kwl":"audio_gain.levels[0].outputs[0].control", "kw": {"gain": {"0": -6.0, "7": +2.0}}}`

- `tree`
  Modify multiple keywords over multiple keyword lists in a compact format. The field `kwl` is a JSON object containing the first sub tree to modify.
  The field names are the keyword list names, and the values are JSON objects containing:

  - `kwl` (optional) another subtree, the keyword list names are relative to the current keyword list.
  - `kw` (optional) a JSON object where the field names are the keyword names.
    More than one keyword can be set in a single command.

  Example: `{"op": "tree", "kwl": {"color_correction": {"kw": {"source_command": "video_signal_generator.output"}, "kwl": {"yuv": {"kw": {"active_command": true, "hue_offset": 0.01}}}}}}`

  Array keywords are handled as with the `data` opcode.

- `subscribe`
  Subscribe to get notified when a keyword changes its value. The following fields are required:

  - `kwl` The keyword list name or an array of keyword list names
  - `kw` (optional) The keyword name or an array of keyword names

  When an array of keyword list names is specified then the specified keywords are subscribed for each of the specified keyword lists.
  Keyword list names can also contain ranges where array / table indices are specified.

  When an array of keyword names is specified then all specified keywords are subscribed for each listed keyword list.
  When no keyword names are specified then all keywords of the specified keyword lists are subscribed (this can be a lot of keywords!).

  Examples

  - `{"op": "subscribe", "kwl": "p_t_p_clock", "kw": ["state", "relative_clock_speed"]}`
  - `{"op": "subscribe", "kwl": "network_interfaces.ports[0:1].aggregate_traffic_statistics.rx_multicast", "kw": "packets_per_sec"}`

  If a keyword was already subscribed then that keyword is ignored, otherwise the current value is sent back. You can use the `marker` function to get a notification when all subscription commands have been executed.

- `subscribe` (with ID)
  Subscribe to get notified when a keyword changes its value. The following fields are required:

  - `kwl` The keyword list name or an array of keyword list names
  - `kw` The keyword name or an array of keyword names
  - `id` The starting ID - the client assigns this ID and must ensure that it is unique within the websocket session's active subscriptions.
    The maximum ID value is 0x7FFFFFFE.

  When an array of keyword list names is specified then the specified keywords are subscribed for each of the specified keyword lists.
  Keyword list names can also contain ranges where array / table indices are specified.

  When an array of keyword names is specified then all specified keywords are subscribed for each listed keyword list.
  The number of IDs used is `number of kwls` times `number of kw`, starting with all specified keyword in `kw` in the first `kwl`. If ranges are used than these are expanded before.

  If an keyword or keyword list is not found the IDs which would be assigned to it are skipped so that the remaining keywords get their ID independent of any previous errors. If an entry in `kwl` can't be parsed the command will stop and all following entries are ignored.

  Examples

  - `{"op": "subscribe", "kwl": ["network_interfaces.ports[0].aggregate_traffic_statistics.rx_unicast", "network_interfaces.ports[0].aggregate_traffic_statistics.rx_multicast"], "kw": ["bytes_total", "packets_total"], "id": 42}`

    In this example the IDs assigned are as following: 42. network_interfaces.ports[0].aggregate_traffic_statistics.rx_unicast.bytes_total 43. network_interfaces.ports[0].aggregate_traffic_statistics.rx_unicast.packets_total 44. network_interfaces.ports[0].aggregate_traffic_statistics.rx_multicast.bytes_total 45. network_interfaces.ports[0].aggregate_traffic_statistics.rx_multicast.packets_total

  - `{"op": "subscribe", "kwl": ["network_interfaces.ports[0:1].aggregate_traffic_statistics.rx_unicast", "network_interfaces.ports[0:1].aggregate_traffic_statistics.rx_multicast"], "kw": ["bytes_total", "packets_total"], "id": 42}`

    In this example the IDs assigned are as following: 42. network_interfaces.ports[0].aggregate_traffic_statistics.rx_unicast.bytes_total 43. network_interfaces.ports[0].aggregate_traffic_statistics.rx_unicast.packets_total 44. network_interfaces.ports[1].aggregate_traffic_statistics.rx_unicast.bytes_total 45. network_interfaces.ports[1].aggregate_traffic_statistics.rx_unicast.packets_total 46. network_interfaces.ports[0].aggregate_traffic_statistics.rx_multicast.bytes_total 47. network_interfaces.ports[0].aggregate_traffic_statistics.rx_multicast.packets_total 48. network_interfaces.ports[1].aggregate_traffic_statistics.rx_multicast.bytes_total 49. network_interfaces.ports[1].aggregate_traffic_statistics.rx_multicast.packets_total

- `unsubscribe`
  Unsubscribe from keyword change notification and clears the ID. This command has the same fields and features as the `subscribe` command (except the `id`).
- `readAll`
  Read the current value of one or more keywords. This command has the same fields and features as the `subscribe` command.
  Unlike the subscribe command - this command will always send back the current value of a keyword even if a subscription exists.
- `flags`
  Modify flags of the current websocket session. The following flags are currently defined:

  - `report errors`
    When set to `true` all errors encountered while parsing commands are reported via `error report` response messages.
    Possible errors include unknown keyword (list) names or wrong value formats for keywords.

  Example: `{"op": "flags", "flags": {"report errors":true}}`

  A possible error response message may look like this: `{"error report": {"msg": "ParseError", "params": ["pool", "table_cmd", "DELETE_NO_ROWS"]}}`

Additionally it is possible to send multiple commands in the same websocket message by packing them into a JSON array.
A websocket message message must not exceed 1MB (1048576 bytes) or the websocket connection will be closed.

# Tables / the rowMask keyword

There are several keyword lists representing tables in the C100/AT300 which have a dynamic number of rows (including gaps).
One example of this is the table `i_o_module.input`. It has a keyword named `rowMask` which can only be read/subscribed and encodes which table rows exist.
The value is a string containing hex bytes. The first character encodes the present bits of table rows 0 to 3 (bit 0 for row 0 etc). The 2nd character encodes the present bits of table row 4 to 7 etc. Trailing 0 characters can be omitted.

The rows are named based on the table name with their index appended in brackets: `i_o_module.input[0]`

# Working with named tables

Named tables are an extension to normal tables. Rows can be created, deleted and named by the user.
Row names are unique within the named table. The following keywords exist on the table level:

- `create_row`
  Create new table rows. As value you can pass the following:

  - `null` Creates a new row with a default name if a free row exists.
  - a JSON object containing one or more of the following requirements:

    - `index` The desired row index
    - `name` The desired row name
    - `allow_reuse_row` If set to `true` an existing row which matches all listed requirements will be returned instead of an error.
    - `request_id` If set to an unsigned 32-bit integer, this ID will be included with the corresponding response to safely distinguish between concurrent row creation requests. Note that `request_id` is only supported if `protocol_features['create_row_request_id'] = true`; submitting request IDs to older software versions will cause the request to be denied.

  If requirements are listed then all must be fulfilled or the request fails. If for example the specified row name already exists with another index than the requested one the request to create the row fails.

  The result of creating the row is sent back only to the websocket connection from which the `create_row` command was received via the keyword `created_row` (you must subscribe to this keyword before sending the create row command).

- `created_row`
  A subscribe only status keyword which is used to return the result of the `create_row` keyword.
  The value is an array of at least 2 elements, where the first entry is the row index and the second entry is the row name. If the row creation failed then both entries are `null`. If a `request_id` had been specified as part of the `create_row` request, it will be returned as the array's third entry.
- `table_cmd`
  Commands which affect all rows of the table:

  - `NOOP` Does nothing
  - `DELETE_ALL_ROWS` Delete all rows of the table which can be deleted. Some tables have restriction that prevent deleting 'active' table rows. The definition of this depends on the named table.

In addition to the table keywords each named table row also has additional keywords:

- `row_name_command`
  Change the name of the table row. The name must follow the row name rules and must not be in use by another row of this table.
- `row_name_status`
  The current name of the table row.
- `row_cmd`
  Commands which affect only this table row:

  - `NOOP` Does nothing
  - `DELETE_ROW` Delete this table row if it can be deleted.

Row names have a maximum length of 32 bytes and must be in UTF8 format. The following characters are not allowed:

- Control characters below 32
- `"` quotation mark
- `\` back space

## Receiving responses from C100/AT300

Each response is a JSON array which can contain one or more of the following JSON objects:

- `kwl`, `kw`
  Keyword changes for keywords `subscribe` without ID or `readAll` results.

  `kwl` is a string naming the keyword list, and `kw` is a JSON object where the keys are
  the keyword names inside the specified keyword list.
  Examples: `{"kwl":"network_interfaces.ports[0].aggregate_traffic_statistics.rx_unicast","kw":{"bytes_total":675234,"packets_total":562}}`

- `id`
  Keyword changes for keywords `subscribe` with ID.

  This contains a JSON object where the keys are the user defined IDs.
  Example: `{"id":{"42":675234,"43":562}}`

The last JSON object in the array can also be one of the following. In which case
the next websocket packet needs to be handled differently:

- `file`
  An inline file (either text or binary) is sent following this websocket packet.
  The name of the file is specified as a value of this parameter.

- `thumbnail`
  An inline thumbnail (JPEG format) is sent as a binary packet following this websocket packet.
  The name of the thumbnail is specified as a value of this parameter.

  Currently NOT implemented.

After the special packet has been send a normal JSON array is sent again.
