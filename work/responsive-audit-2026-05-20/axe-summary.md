# Responsive Audit — a11y (axe-core) Summary

_Generated 2026-05-20T06:49:25.722Z_

| Impact | Rule | Nodes total | Captures impacted | Description |
|---|---|---|---|---|
| critical | [image-alt](https://dequeuniversity.com/rules/axe/4.10/image-alt?application=axeAPI) | 182 | 24 | Ensure <img> elements have alternative text or a role of none or presentation |
| critical | [aria-required-attr](https://dequeuniversity.com/rules/axe/4.10/aria-required-attr?application=axeAPI) | 12 | 12 | Ensure elements with ARIA roles have all required ARIA attributes |
| critical | [button-name](https://dequeuniversity.com/rules/axe/4.10/button-name?application=axeAPI) | 4 | 2 | Ensure buttons have discernible text |
| critical | [aria-required-children](https://dequeuniversity.com/rules/axe/4.10/aria-required-children?application=axeAPI) | 4 | 4 | Ensure elements with an ARIA role that require child roles contain them |
| serious | [color-contrast](https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=axeAPI) | 132 | 51 | Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds |
| serious | [scrollable-region-focusable](https://dequeuniversity.com/rules/axe/4.10/scrollable-region-focusable?application=axeAPI) | 32 | 23 | Ensure elements that have scrollable content are accessible by keyboard |
| serious | [aria-dialog-name](https://dequeuniversity.com/rules/axe/4.10/aria-dialog-name?application=axeAPI) | 24 | 16 | Ensure every ARIA dialog and alertdialog node has an accessible name |
| serious | [aria-input-field-name](https://dequeuniversity.com/rules/axe/4.10/aria-input-field-name?application=axeAPI) | 4 | 4 | Ensure every ARIA input field has an accessible name |
| moderate | [landmark-main-is-top-level](https://dequeuniversity.com/rules/axe/4.10/landmark-main-is-top-level?application=axeAPI) | 48 | 32 | Ensure the main landmark is at top level |
| moderate | [landmark-no-duplicate-main](https://dequeuniversity.com/rules/axe/4.10/landmark-no-duplicate-main?application=axeAPI) | 48 | 32 | Ensure the document has at most one main landmark |
| moderate | [landmark-unique](https://dequeuniversity.com/rules/axe/4.10/landmark-unique?application=axeAPI) | 48 | 32 | Ensure landmarks are unique |
| moderate | [landmark-banner-is-top-level](https://dequeuniversity.com/rules/axe/4.10/landmark-banner-is-top-level?application=axeAPI) | 16 | 8 | Ensure the banner landmark is at top level |
| moderate | [page-has-heading-one](https://dequeuniversity.com/rules/axe/4.10/page-has-heading-one?application=axeAPI) | 14 | 9 | Ensure that the page, or at least one of its frames contains a level-one heading |
| moderate | [region](https://dequeuniversity.com/rules/axe/4.10/region?application=axeAPI) | 8 | 8 | Ensure all page content is contained by landmarks |
| minor | [presentation-role-conflict](https://dequeuniversity.com/rules/axe/4.10/presentation-role-conflict?application=axeAPI) | 1914 | 24 | Elements marked as presentational should not have global ARIA or tabindex to ensure all screen readers ignore them |
| minor | [aria-allowed-role](https://dequeuniversity.com/rules/axe/4.10/aria-allowed-role?application=axeAPI) | 18 | 18 | Ensure role attribute has an appropriate value for the element |