use crate::parser::convert::{self, ParseError, SchemaIR};
use crate::parser::preprocess;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseResult {
    pub schema: Option<SchemaIR>,
    pub error: Option<ParseError>,
}

fn parse_dbml_sync(input: &str) -> ParseResult {
    let (cleaned, sticky_notes) = preprocess::preprocess(input);
    match dbml_rs::parse_dbml(&cleaned) {
        Ok(ast) => {
            let mut schema = convert::convert_schema(&ast);
            schema.notes.extend(sticky_notes);
            ParseResult {
                schema: Some(schema),
                error: None,
            }
        }
        Err(e) => {
            let span = match e.location {
                pest::error::InputLocation::Pos(p) => Some((p, p)),
                pest::error::InputLocation::Span((s, end)) => Some((s, end)),
            };
            ParseResult {
                schema: None,
                error: Some(ParseError {
                    message: e.to_string(),
                    span,
                }),
            }
        }
    }
}

// Async + spawn_blocking: dbml-rs is superlinear (~600ms at 1000 tables), so
// the parse runs on the blocking pool instead of stalling other IPC commands
// (file ops, window close) behind it.
#[tauri::command]
pub async fn parse_dbml(input: String) -> ParseResult {
    tauri::async_runtime::spawn_blocking(move || parse_dbml_sync(&input))
        .await
        .unwrap_or_else(|e| ParseResult {
            schema: None,
            error: Some(ParseError {
                message: format!("parse task failed: {e}"),
                span: None,
            }),
        })
}

#[cfg(test)]
mod tests {
    use super::parse_dbml_sync;

    #[test]
    fn mysql_types_and_named_unique_btree_indexes_are_preserved() {
        let input = r#"
Table parent {
  id char(36) [pk]
  pid varchar(36)
  status tinyint [not null, default: 1]
  enabled tinyint(1) [not null, default: 0]
  updated datetime(6) [default: `CURRENT_TIMESTAMP`]
  body longtext
  indexes {
    (status, enabled) [name: 'uk_status_enabled', unique, type: btree]
  }
}
Ref: parent.pid > parent.id
"#;
        let parsed = parse_dbml_sync(input);
        assert!(parsed.error.is_none(), "{:?}", parsed.error.map(|e| e.message));
        let schema = parsed.schema.unwrap();
        let table = &schema.tables[0];
        assert_eq!(table.columns[1].r#type, "varchar(36)");
        assert_eq!(table.columns[2].r#type, "tinyint");
        assert_eq!(table.columns[3].r#type, "tinyint(1)");
        assert_eq!(table.columns[4].r#type, "datetime(6)");
        assert_eq!(table.columns[5].r#type, "longtext");
        assert_eq!(table.indexes[0].name.as_deref(), Some("uk_status_enabled"));
        assert!(table.indexes[0].is_unique);
        assert_eq!(table.indexes[0].index_type.as_deref(), Some("btree"));
        assert_eq!(schema.refs.len(), 1);
    }

    #[test]
    fn incompatible_reference_types_still_fail_validation() {
        let input = "Table parent {\n id int [pk]\n pid varchar(36)\n}\nRef: parent.pid > parent.id";
        assert!(parse_dbml_sync(input).error.is_some());
    }
}
