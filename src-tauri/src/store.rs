use crate::database::Database;
use crate::services::UsageCache;
use std::sync::Arc;

/// 全局应用状态
pub struct AppState {
    pub db: Arc<Database>,
    pub usage_cache: Arc<UsageCache>,
}

impl AppState {
    /// 创建新的应用状态
    pub fn new(db: Arc<Database>) -> Self {
        Self {
            db,
            usage_cache: Arc::new(UsageCache::new()),
        }
    }
}
