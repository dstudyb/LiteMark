import { sql } from '@vercel/postgres';

export interface BookmarkRecord {
  id: string;
  title: string;
  url: string;
  category?: string | null;
  description?: string | null;
  visible?: boolean;
  order?: number;
  categoryOrder?: number;
}

export interface Settings {
  theme?: string;
  siteTitle?: string;
  siteIcon?: string;
}

// 初始化数据库表
async function initTables() {
  try {
    // 创建书签表
    await sql`
      CREATE TABLE IF NOT EXISTS bookmarks (
        id VARCHAR(255) PRIMARY KEY,
        title VARCHAR(500) NOT NULL,
        url TEXT NOT NULL,
        category VARCHAR(255),
        description TEXT,
        visible BOOLEAN DEFAULT true,
        "order" INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // 创建分类顺序表
    await sql`
      CREATE TABLE IF NOT EXISTS category_order (
        id SERIAL PRIMARY KEY,
        category VARCHAR(255) UNIQUE NOT NULL,
        "order" INTEGER NOT NULL
      )
    `;

    // 创建设置表
    await sql`
      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // 创建索引
    await sql`
      CREATE INDEX IF NOT EXISTS idx_bookmarks_category ON bookmarks(category)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_bookmarks_order ON bookmarks("order")
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_category_order_order ON category_order("order")
    `;
  } catch (error) {
    console.error('初始化数据库表失败', error);
    // 不抛出错误，允许表已存在的情况
  }
}

// 确保表已初始化
let tablesInitialized = false;
async function ensureTables() {
  if (!tablesInitialized) {
    await initTables();
    tablesInitialized = true;
  }
}

function normalizeCategory(category?: string | null): string {
  return (category ?? '').trim() || '';
}

export async function listBookmarks(): Promise<BookmarkRecord[]> {
  await ensureTables();
  
  // 获取分类顺序
  const categoryOrderResult = await sql`
    SELECT category FROM category_order ORDER BY "order" ASC
  `;
  const categoryOrder = categoryOrderResult.rows.map(row => row.category as string);
  
  // 获取所有书签
  const bookmarksResult = await sql`
    SELECT id, title, url, category, description, visible, "order"
    FROM bookmarks
    ORDER BY "order" ASC
  `;
  
  const bookmarks = bookmarksResult.rows.map(row => ({
    id: row.id as string,
    title: row.title as string,
    url: row.url as string,
    category: (row.category as string) || null,
    description: (row.description as string) || null,
    visible: row.visible !== false,
    order: (row.order as number) || 0
  }));
  
  // 按分类顺序排序
  const sorted = [...bookmarks].sort((a, b) => {
    const catA = normalizeCategory(a.category);
    const catB = normalizeCategory(b.category);
    
    // 先按分类顺序
    const indexA = categoryOrder.indexOf(catA);
    const indexB = categoryOrder.indexOf(catB);
    if (indexA !== indexB) {
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      return indexA - indexB;
    }
    
    // 再按分类内顺序
    return (a.order ?? 0) - (b.order ?? 0);
  });
  
  return sorted;
}

export async function createBookmark(data: Omit<BookmarkRecord, 'id' | 'order'>): Promise<BookmarkRecord> {
  await ensureTables();
  
  const category = normalizeCategory(data.category);
  
  // 找到同分类中最大的 order
  const maxOrderResult = await sql`
    SELECT COALESCE(MAX("order"), -1) as max_order
    FROM bookmarks
    WHERE category = ${category || null}
  `;
  const maxOrder = (maxOrderResult.rows[0]?.max_order as number) ?? -1;
  
  const id = crypto.randomUUID();
  const order = maxOrder + 1;
  
  await sql`
    INSERT INTO bookmarks (id, title, url, category, description, visible, "order")
    VALUES (${id}, ${data.title}, ${data.url}, ${category || null}, ${data.description || null}, ${data.visible ?? true}, ${order})
  `;
  
  return {
    ...data,
    id,
    order,
    category: category || null
  };
}

export async function updateBookmark(id: string, data: Partial<Omit<BookmarkRecord, 'id'>>): Promise<BookmarkRecord | null> {
  await ensureTables();
  
  // 获取当前书签
  const currentResult = await sql`
    SELECT * FROM bookmarks WHERE id = ${id}
  `;
  
  if (currentResult.rows.length === 0) {
    return null;
  }
  
  const current = currentResult.rows[0];
  const oldCategory = normalizeCategory(current.category as string);
  const newCategory = normalizeCategory(data.category);
  
  // 如果分类改变，需要调整顺序
  if (newCategory !== oldCategory) {
    // 从旧分类移除，调整其他书签的顺序
    await sql`
      UPDATE bookmarks
      SET "order" = "order" - 1
      WHERE category = ${oldCategory || null}
        AND "order" > ${current.order as number}
    `;
    
    // 添加到新分类末尾
    const maxOrderResult = await sql`
      SELECT COALESCE(MAX("order"), -1) as max_order
      FROM bookmarks
      WHERE category = ${newCategory || null}
    `;
    const maxOrder = (maxOrderResult.rows[0]?.max_order as number) ?? -1;
    data.order = maxOrder + 1;
  }
  
  // 更新书签
  const title = data.title !== undefined ? data.title : (current.title as string);
  const url = data.url !== undefined ? data.url : (current.url as string);
  const category = data.category !== undefined 
    ? (normalizeCategory(data.category) || null)
    : (current.category as string || null);
  const description = data.description !== undefined 
    ? (data.description || null)
    : (current.description as string || null);
  const visible = data.visible !== undefined 
    ? (data.visible ?? true)
    : (current.visible !== false);
  const order = data.order !== undefined 
    ? data.order 
    : (current.order as number || 0);
  
  await sql`
    UPDATE bookmarks
    SET 
      title = ${title},
      url = ${url},
      category = ${category},
      description = ${description},
      visible = ${visible},
      "order" = ${order},
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${id}
  `;
  
  // 返回更新后的书签
  const updatedResult = await sql`
    SELECT * FROM bookmarks WHERE id = ${id}
  `;
  
  const row = updatedResult.rows[0];
  return {
    id: row.id as string,
    title: row.title as string,
    url: row.url as string,
    category: (row.category as string) || null,
    description: (row.description as string) || null,
    visible: row.visible !== false,
    order: (row.order as number) || 0
  };
}

export async function deleteBookmark(id: string): Promise<BookmarkRecord | null> {
  await ensureTables();
  
  // 获取要删除的书签
  const currentResult = await sql`
    SELECT * FROM bookmarks WHERE id = ${id}
  `;
  
  if (currentResult.rows.length === 0) {
    return null;
  }
  
  const deleted = currentResult.rows[0];
  const category = normalizeCategory(deleted.category as string);
  const order = deleted.order as number;
  
  // 调整同分类中其他书签的顺序
  await sql`
    UPDATE bookmarks
    SET "order" = "order" - 1
    WHERE category = ${category || null}
      AND "order" > ${order}
  `;
  
  // 删除书签
  await sql`
    DELETE FROM bookmarks WHERE id = ${id}
  `;
  
  return {
    id: deleted.id as string,
    title: deleted.title as string,
    url: deleted.url as string,
    category: (deleted.category as string) || null,
    description: (deleted.description as string) || null,
    visible: deleted.visible !== false,
    order: (deleted.order as number) || 0
  };
}

export async function reorderBookmarks(order: string[]): Promise<BookmarkRecord[]> {
  await ensureTables();
  
  // 更新每个书签的顺序
  for (let i = 0; i < order.length; i++) {
    await sql`
      UPDATE bookmarks
      SET "order" = ${i}
      WHERE id = ${order[i]}
    `;
  }
  
  // 未出现的 ID 追加到末尾
  const allBookmarksResult = await sql`
    SELECT id FROM bookmarks
  `;
  const allIds = allBookmarksResult.rows.map(row => row.id as string);
  const missingIds = allIds.filter(id => !order.includes(id));
  
  let nextOrder = order.length;
  for (const id of missingIds) {
    await sql`
      UPDATE bookmarks
      SET "order" = ${nextOrder}
      WHERE id = ${id}
    `;
    nextOrder++;
  }
  
  return await listBookmarks();
}

export async function reorderBookmarkCategories(order: string[]): Promise<BookmarkRecord[]> {
  await ensureTables();
  
  // 清空现有分类顺序
  await sql`DELETE FROM category_order`;
  
  // 插入新的分类顺序
  for (let i = 0; i < order.length; i++) {
    await sql`
      INSERT INTO category_order (category, "order")
      VALUES (${order[i]}, ${i})
      ON CONFLICT (category) DO UPDATE SET "order" = ${i}
    `;
  }
  
  return await listBookmarks();
}

export async function getSettings(): Promise<Settings> {
  await ensureTables();
  
  const result = await sql`
    SELECT key, value FROM settings
    WHERE key IN ('theme', 'siteTitle', 'siteIcon')
  `;
  
  const settings: Settings = {
    theme: 'light',
    siteTitle: '个人书签',
    siteIcon: '🔖'
  };
  
  result.rows.forEach(row => {
    const key = row.key as string;
    const value = row.value as string;
    if (key === 'theme') {
      settings.theme = value;
    } else if (key === 'siteTitle') {
      settings.siteTitle = value;
    } else if (key === 'siteIcon') {
      settings.siteIcon = value;
    }
  });
  
  return settings;
}

export async function updateSettings(data: Partial<Settings>): Promise<Settings> {
  await ensureTables();
  
  // 验证 theme
  const validThemes = ['light', 'dark', 'forest', 'ocean', 'sunrise', 'twilight'];
  if (data.theme && !validThemes.includes(data.theme)) {
    throw new Error('主题必须是 light/dark/forest/ocean/sunrise/twilight 之一');
  }
  
  // 验证 siteTitle
  if (data.siteTitle && data.siteTitle.length > 60) {
    throw new Error('站点标题不能超过 60 个字符');
  }
  
  // 验证 siteIcon
  if (data.siteIcon && data.siteIcon.length > 512) {
    throw new Error('站点图标不能超过 512 个字符');
  }
  
  // 更新设置
  if (data.theme !== undefined) {
    await sql`
      INSERT INTO settings (key, value, updated_at)
      VALUES ('theme', ${data.theme}, CURRENT_TIMESTAMP)
      ON CONFLICT (key) DO UPDATE SET value = ${data.theme}, updated_at = CURRENT_TIMESTAMP
    `;
  }
  
  if (data.siteTitle !== undefined) {
    await sql`
      INSERT INTO settings (key, value, updated_at)
      VALUES ('siteTitle', ${data.siteTitle}, CURRENT_TIMESTAMP)
      ON CONFLICT (key) DO UPDATE SET value = ${data.siteTitle}, updated_at = CURRENT_TIMESTAMP
    `;
  }
  
  if (data.siteIcon !== undefined) {
    await sql`
      INSERT INTO settings (key, value, updated_at)
      VALUES ('siteIcon', ${data.siteIcon}, CURRENT_TIMESTAMP)
      ON CONFLICT (key) DO UPDATE SET value = ${data.siteIcon}, updated_at = CURRENT_TIMESTAMP
    `;
  }
  
  return await getSettings();
}

// Storage 相关（用于备份功能）
export interface StorageData {
  config?: any;
  save?(): Promise<void>;
}

let storageInstance: StorageData | null = null;

export async function getStorage(): Promise<StorageData> {
  if (!storageInstance) {
    await ensureTables();
    
    const result = await sql`
      SELECT value FROM settings WHERE key = 'storage_config'
    `;
    
    storageInstance = {
      config: result.rows.length > 0 ? JSON.parse(result.rows[0].value as string) : null,
      save: async () => {
        await sql`
          INSERT INTO settings (key, value, updated_at)
          VALUES ('storage_config', ${JSON.stringify(storageInstance?.config || null)}, CURRENT_TIMESTAMP)
          ON CONFLICT (key) DO UPDATE SET value = ${JSON.stringify(storageInstance?.config || null)}, updated_at = CURRENT_TIMESTAMP
        `;
      }
    };
  }
  return storageInstance;
}
