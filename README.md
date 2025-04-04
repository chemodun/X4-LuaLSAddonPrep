# Source Data Repo for the Lua Language Server Addon for X4: Foundations Lua Scripts

This repo holds a source data for the [Lua Language Server Addon for X4: Foundations Lua Scripts](https://github.com/chemodun/X4-LuaLSAddonPrep).
Mentioned repo contains an [addon](https://luals.github.io/wiki/addons/) for X4: Foundations Lua Scripts that can be used by the [Lua Language Server](https://luals.github.io/). It adds definitions for functions and data types.
This addon is designed to enhance the development experience for Lua scripting in X4: Foundations.

## How to use the addon

Please refer to the appropriate [Readme](https://github.com/chemodun/X4-LuaLSAddon) file for the respective addon.

## Progress

<details>

- [x] Get data from the [X Wiki](https://wiki.egosoft.com:1337/X%20Rebirth%20Wiki/Modding%20support/UI%20Modding%20support/Lua%20function%20overview/)
- [x] Parse the data
- [ ] Reconciliation of the data from Wiki
- [x] Add data from an extracted Lua files for ffi/C functions and data types
- [ ] Enrichment of the data from the extracted Lua files
- [x] Add data from the extracted Lua files for the Helper functions
- [ ] Enrichment of the data for the Helper functions
- [x] Add data from the extracted Lua files for the Globally Exposed functions via `AddGlobalAccess`.
- [ ] Reconciliation and enrichment of the Globally Exposed functions
- [x] Detection of the undocumented functions
- [ ] Reconciliation and enrichment of the undocumented functions

</details>

## This source data

The data is collected into the [Hjson](https://hjson.github.io/) format for easier manipulation and access.

### Lua Documented Functions

Located in the [x4-lua-functions.hjson](data/x4-lua-functions.hjson) file.

This file contains the data for the documented functions. The data is collected from the X Wiki.

### Lua Undocumented Functions

Located in the [x4-undocumented-functions.hjson](data/x4-undocumented-functions.hjson) file.

This file contains the data for the undocumented functions. The data is collected from the extracted Lua files.
The data is not reconciled with the X Wiki data.

### Lua C Functions and Types Definitions

Located in the [x4-ffi-definitions.hjson](data/x4-ffi-definitions.hjson) file.

This file contains the data for the C functions and types definitions. The data is collected from the extracted Lua files.

### Lua Helper Functions

Located in the [x4-helper-functions.hjson](data/x4-helper-functions.hjson) file.

This file contains the data for the Helper functions. The data is collected from the extracted Lua files.

### Lua Globally Exposed Functions

Located in the [x4-globally-exposed.hjson](data/x4-globally-exposed.hjson) file.

This file contains the data for the function globally accessed via AddGlobalAccess. The data is collected from the extracted Lua files.

## The main idea

- To reconcile the data [from the X Wiki](#lua-documented-functions).
- To eliminate the [Undocumented](#lua-undocumented-functions) sections at all or by removing the possible duplicates with the [documented functions](#lua-documented-functions) or by moving them to it after documenting them.

## Contribution

If you want to contribute to the project, please take part in editing respective `.hjson` files.

## License

This addon is licensed under the MIT license.
See [LICENSE](LICENSE) for the full license text.
