# Local dbml-rs changes

This directory contains dbml-rs 1.0.1 under its original MIT OR Apache-2.0
license. The application uses this copy to retain source spans and raw column
types while supporting MySQL DBML:

- Recognize `tinyint`, `datetime` and MySQL text variants; allow the optional
  display width on `tinyint`.
- Allow index methods such as `btree` together with `unique` or `pk`.
- Accept references between equally sized `char` and `varchar` columns.

These changes are candidates for contributing upstream. Remove the local copy
once a suitable upstream release includes the fixes.
