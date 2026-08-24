# Tokens to SCSS — Penpot plugin

It collects one SCSS file for each set of tokens present in the file (all Sets — Global/, Theme/, and any others), preserving the links between tokens as SCSS variables ($spacing-12: $base-module * 1, not 12px). Compound types (typography, shadow) are handled via SCSS map + @mixin. After generation, there are “Download” buttons for each file and “Download everything in one .zip”.
