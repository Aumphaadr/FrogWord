use rusqlite::{
    params_from_iter,
    types::{Value as SqliteValue, ValueRef},
    Connection,
};
use serde::Serialize;
use serde_json::{Map as JsonMap, Number as JsonNumber, Value as JsonValue};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Manager, State};

const DATABASE_FILE_NAME: &str = "frogword.sqlite3";

#[derive(Default)]
struct StorageState {
    connection: Mutex<Option<Connection>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageStatus {
    database_path: String,
    exists: bool,
}

#[tauri::command]
fn frogword_storage_status(app: AppHandle) -> Result<StorageStatus, String> {
    let database_path = database_path(&app)?;
    Ok(StorageStatus {
        exists: database_path.exists(),
        database_path: database_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn frogword_execute_sql(
    app: AppHandle,
    state: State<'_, StorageState>,
    sql: String,
    params: Option<Vec<JsonValue>>,
) -> Result<(), String> {
    let params = sql_params(params)?;
    with_connection(&app, state.inner(), |connection| {
        connection
            .execute(sql.as_str(), params_from_iter(params.iter()))
            .map_err(sqlite_error)?;
        Ok(())
    })
}

#[tauri::command]
fn frogword_query_sql(
    app: AppHandle,
    state: State<'_, StorageState>,
    sql: String,
    params: Option<Vec<JsonValue>>,
) -> Result<Vec<JsonValue>, String> {
    let params = sql_params(params)?;
    with_connection(&app, state.inner(), |connection| {
        let mut statement = connection.prepare(sql.as_str()).map_err(sqlite_error)?;
        let column_count = statement.column_count();
        let column_names = (0..column_count)
            .map(|index| statement.column_name(index).unwrap_or("").to_string())
            .collect::<Vec<_>>();
        let mut rows = statement
            .query(params_from_iter(params.iter()))
            .map_err(sqlite_error)?;
        let mut values = Vec::new();

        while let Some(row) = rows.next().map_err(sqlite_error)? {
            let mut object = JsonMap::new();
            for index in 0..column_count {
                let name = column_names
                    .get(index)
                    .cloned()
                    .unwrap_or_else(|| format!("column_{index}"));
                let value = row.get_ref(index).map_err(sqlite_error)?;
                object.insert(name, json_from_sqlite_value(value)?);
            }
            values.push(JsonValue::Object(object));
        }

        Ok(values)
    })
}

fn with_connection<T>(
    app: &AppHandle,
    state: &StorageState,
    callback: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = state
        .connection
        .lock()
        .map_err(|_| "SQLite connection lock is poisoned".to_string())?;

    if guard.is_none() {
        let path = database_path(app)?;
        let connection = Connection::open(path).map_err(sqlite_error)?;
        connection
            .pragma_update(None, "foreign_keys", true)
            .map_err(sqlite_error)?;
        *guard = Some(connection);
    }

    let connection = guard
        .as_ref()
        .ok_or_else(|| "SQLite connection is unavailable".to_string())?;
    callback(connection)
}

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Failed to create app data directory: {error}"))?;
    Ok(directory.join(DATABASE_FILE_NAME))
}

fn sql_params(params: Option<Vec<JsonValue>>) -> Result<Vec<SqliteValue>, String> {
    params
        .unwrap_or_default()
        .into_iter()
        .map(sqlite_value_from_json)
        .collect()
}

fn sqlite_value_from_json(value: JsonValue) -> Result<SqliteValue, String> {
    match value {
        JsonValue::Null => Ok(SqliteValue::Null),
        JsonValue::Bool(value) => Ok(SqliteValue::Integer(i64::from(value))),
        JsonValue::Number(value) => {
            if let Some(integer) = value.as_i64() {
                Ok(SqliteValue::Integer(integer))
            } else if let Some(unsigned) = value.as_u64() {
                i64::try_from(unsigned)
                    .map(SqliteValue::Integer)
                    .map_err(|_| format!("Integer parameter is too large for SQLite: {unsigned}"))
            } else if let Some(real) = value.as_f64() {
                Ok(SqliteValue::Real(real))
            } else {
                Err("Unsupported numeric SQL parameter".to_string())
            }
        }
        JsonValue::String(value) => Ok(SqliteValue::Text(value)),
        JsonValue::Array(values) => values
            .into_iter()
            .map(|value| match value {
                JsonValue::Number(number) => number
                    .as_u64()
                    .and_then(|byte| u8::try_from(byte).ok())
                    .ok_or_else(|| "Blob parameters must be arrays of bytes".to_string()),
                _ => Err("Blob parameters must be arrays of bytes".to_string()),
            })
            .collect::<Result<Vec<_>, _>>()
            .map(SqliteValue::Blob),
        JsonValue::Object(_) => Err("Object SQL parameters are not supported".to_string()),
    }
}

fn json_from_sqlite_value(value: ValueRef<'_>) -> Result<JsonValue, String> {
    match value {
        ValueRef::Null => Ok(JsonValue::Null),
        ValueRef::Integer(value) => Ok(JsonValue::Number(JsonNumber::from(value))),
        ValueRef::Real(value) => JsonNumber::from_f64(value)
            .map(JsonValue::Number)
            .ok_or_else(|| format!("SQLite returned a non-finite number: {value}")),
        ValueRef::Text(value) => Ok(JsonValue::String(String::from_utf8_lossy(value).to_string())),
        ValueRef::Blob(value) => Ok(JsonValue::Array(
            value
                .iter()
                .copied()
                .map(|byte| JsonValue::Number(JsonNumber::from(byte)))
                .collect(),
        )),
    }
}

fn sqlite_error(error: rusqlite::Error) -> String {
    error.to_string()
}

fn main() {
    tauri::Builder::default()
        .manage(StorageState::default())
        .invoke_handler(tauri::generate_handler![
            frogword_storage_status,
            frogword_execute_sql,
            frogword_query_sql
        ])
        .run(tauri::generate_context!())
        .expect("error while running FrogWord desktop shell");
}
