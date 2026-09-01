#!/usr/bin/env python3
"""Import active Workbuddy boards/cards into the configured Vistask database."""

from __future__ import annotations

import sqlite3
from datetime import datetime
from pathlib import Path


SOURCE = Path("/Users/ranshaoqiang/Library/CloudStorage/OneDrive-个人/lmrt/transactions.db")
TARGET = Path("/Users/ranshaoqiang/Library/CloudStorage/OneDrive-个人/vistask.db")
PROJECT_ID = "workbuddy-import-20260731"
PROJECT_TITLE = "Workbuddy"


def main() -> None:
    source = sqlite3.connect(f"file:{SOURCE}?mode=ro", uri=True)
    source.row_factory = sqlite3.Row
    target = sqlite3.connect(TARGET, timeout=30)
    target.row_factory = sqlite3.Row
    target.execute("PRAGMA foreign_keys = ON")

    active_boards = source.execute(
        """
        SELECT * FROM boards
        WHERE COALESCE(is_delete, 0) = 0 AND COALESCE(is_deleted, 0) = 0
        ORDER BY sort, id
        """
    ).fetchall()
    active_board_ids = {row["id"] for row in active_boards}
    active_cards = source.execute(
        """
        SELECT * FROM board_cards
        WHERE COALESCE(is_deleted, 0) = 0
        ORDER BY board_id, sort, id
        """
    ).fetchall()
    active_cards = [row for row in active_cards if row["board_id"] in active_board_ids]

    if len(active_boards) != 6 or len(active_cards) != 120:
        raise RuntimeError(
            f"源数据数量与预检不一致：看板 {len(active_boards)}，卡片 {len(active_cards)}"
        )

    backup_path = TARGET.with_name(
        f"{TARGET.name}.backup-before-workbuddy-{datetime.now():%Y%m%d-%H%M%S}"
    )
    backup = sqlite3.connect(backup_path)
    try:
        target.backup(backup)
    finally:
        backup.close()

    now = datetime.now().astimezone().isoformat(timespec="seconds")
    try:
        target.execute("BEGIN IMMEDIATE")
        duplicate_count = target.execute(
            """
            SELECT
              (SELECT COUNT(*) FROM projects WHERE id = ?) +
              (SELECT COUNT(*) FROM boards WHERE id LIKE 'workbuddy-board-%') +
              (SELECT COUNT(*) FROM cards WHERE id LIKE 'workbuddy-card-%')
            """,
            (PROJECT_ID,),
        ).fetchone()[0]
        if duplicate_count:
            raise RuntimeError("检测到已有 Workbuddy 迁移记录，已停止以避免重复导入")

        project_sort = target.execute(
            "SELECT COALESCE(MAX(sort), -1) + 1 FROM projects"
        ).fetchone()[0]
        target.execute(
            """
            INSERT INTO projects
              (id, title, color, sort, record_version, created_at, updated_at, deleted_at)
            VALUES (?, ?, '', ?, 1, ?, ?, NULL)
            """,
            (PROJECT_ID, PROJECT_TITLE, project_sort, now, now),
        )

        for board in active_boards:
            board_id = f"workbuddy-board-{board['id']}"
            created_at = board["created_at"] or now
            target.execute(
                """
                INSERT INTO boards
                  (id, project_id, title, color, sort,
                   filter_staged, filter_in_progress, filter_done, filter_deleted,
                   record_version, created_at, updated_at, deleted_at)
                VALUES (?, ?, ?, ?, ?, 0, 1, 0, 0, 1, ?, ?, NULL)
                """,
                (
                    board_id,
                    PROJECT_ID,
                    board["title"],
                    board["color"] or "",
                    board["sort"],
                    created_at,
                    created_at,
                ),
            )

        active_card_ids = {row["id"] for row in active_cards}
        valid_statuses = {"staged", "in_progress", "done", "deleted"}
        valid_repeat_units = {"minute", "hour", "day", "week", "month", "year"}
        for card in active_cards:
            status = card["status"] if card["status"] in valid_statuses else "in_progress"
            repeat_unit = card["repeat_unit"]
            if repeat_unit not in valid_repeat_units:
                repeat_unit = "day"
            repeat_interval = card["repeat_interval"] or 1
            parent_id = card["parent_id"]
            mapped_parent = (
                f"workbuddy-card-{parent_id}" if parent_id in active_card_ids else None
            )
            target.execute(
                """
                INSERT INTO cards
                  (id, board_id, parent_id, title, content, status, flagged, due_at,
                   repeat_enabled, repeat_interval, repeat_unit, repeat_start, child_mode, sort,
                   focus_minutes, pomodoro_count, record_version,
                   created_at, updated_at, deleted_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL)
                """,
                (
                    f"workbuddy-card-{card['id']}",
                    f"workbuddy-board-{card['board_id']}",
                    mapped_parent,
                    card["title"] or "",
                    card["content"] or "",
                    status,
                    1 if card["flagged"] else 0,
                    card["due_at"] or None,
                    1 if card["repeat_enabled"] else 0,
                    repeat_interval,
                    repeat_unit,
                    card["repeat_start"] or None,
                    "serial" if card["repeat_enabled"] else "parallel",
                    float(card["sort"]),
                    card["focus_minutes"] or 0,
                    card["pomodoro_count"] or 0,
                    card["created_at"] or now,
                    card["updated_at"] or card["created_at"] or now,
                ),
            )

        target.commit()
    except Exception:
        target.rollback()
        raise

    imported_boards = target.execute(
        "SELECT COUNT(*) FROM boards WHERE project_id = ? AND deleted_at IS NULL",
        (PROJECT_ID,),
    ).fetchone()[0]
    imported_cards = target.execute(
        """
        SELECT COUNT(*) FROM cards
        WHERE board_id IN (SELECT id FROM boards WHERE project_id = ?)
          AND deleted_at IS NULL
        """,
        (PROJECT_ID,),
    ).fetchone()[0]
    foreign_key_errors = target.execute("PRAGMA foreign_key_check").fetchall()
    quick_check = target.execute("PRAGMA quick_check").fetchone()[0]
    target.close()
    source.close()

    if imported_boards != 6 or imported_cards != 120 or foreign_key_errors or quick_check != "ok":
        raise RuntimeError(
            "迁移后校验失败："
            f"看板={imported_boards}，卡片={imported_cards}，"
            f"外键错误={len(foreign_key_errors)}，quick_check={quick_check}"
        )

    print(f"backup={backup_path}")
    print(f"project={PROJECT_TITLE}")
    print(f"boards={imported_boards}")
    print(f"cards={imported_cards}")
    print("foreign_key_check=ok")
    print("quick_check=ok")


if __name__ == "__main__":
    main()
