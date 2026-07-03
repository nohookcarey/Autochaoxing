#!/usr/bin/env python3

import json
import sys
from pathlib import Path

import xlrd
from xlutils.copy import copy as xl_copy


ATTENDANCE_START_COL = 6
ATTENDANCE_SLOT_COUNT = 18


def normalize_student_no(value):
    text = str(value).strip()
    if text.endswith(".0"):
        text = text[:-2]
    return text


def load_summary(summary_path):
    return json.loads(Path(summary_path).read_text(encoding="utf-8"))


def normalize_output_value(value):
    text = str(value).strip()
    if text == "迟到":
        return "迟"
    return text


def write_preserving_style(writable_sheet, read_sheet, row_idx, col_idx, value):
    writable_sheet.write(row_idx, col_idx, normalize_output_value(value))
    row = writable_sheet._Worksheet__rows.get(row_idx)
    if row is None:
        return
    cell = row._Row__cells.get(col_idx)
    if cell is None:
        return
    cell.xf_idx = read_sheet.cell_xf_index(row_idx, col_idx)


def write_class_sheet(class_summary):
    sheet_path = Path(class_summary["sheetPath"])
    output_path = Path(class_summary["outputPath"])
    output_path.parent.mkdir(parents=True, exist_ok=True)

    workbook = xlrd.open_workbook(str(sheet_path), formatting_info=True)
    sheet = workbook.sheet_by_index(0)
    writable_workbook = xl_copy(workbook)
    writable_sheet = writable_workbook.get_sheet(0)

    student_records = class_summary.get("studentRecords", [])
    student_slot_map = {
        record["studentNo"]: record["slots"] for record in student_records if record.get("studentNo")
    }
    student_name_map = {
        record["studentNo"]: record.get("name", "")
        for record in student_records
        if record.get("studentNo")
    }
    name_slot_map = {}
    name_collision = set()
    for record in student_records:
        name = str(record.get("name", "")).strip()
        if not name:
            continue
        if name in name_slot_map:
            name_collision.add(name)
            continue
        name_slot_map[name] = record["slots"]

    matched_student_nos = set()
    written_cell_count = 0
    roster_row_count = 0

    for row_idx in range(sheet.nrows):
        student_no = normalize_student_no(sheet.cell_value(row_idx, 1))
        student_name = str(sheet.cell_value(row_idx, 3)).strip()
        if not student_no or not student_name:
            continue
        roster_row_count += 1

        for slot_idx in range(ATTENDANCE_SLOT_COUNT):
            write_preserving_style(writable_sheet, sheet, row_idx, ATTENDANCE_START_COL + slot_idx, "")

        slots = student_slot_map.get(student_no, [])
        if not slots and student_name and student_name not in name_collision:
            slots = name_slot_map.get(student_name, [])
        if not slots:
            continue

        matched_student_nos.add(student_no)
        for slot_idx, value in enumerate(slots[:ATTENDANCE_SLOT_COUNT]):
            write_preserving_style(writable_sheet, sheet, row_idx, ATTENDANCE_START_COL + slot_idx, value)
            written_cell_count += 1

    writable_workbook.save(str(output_path))

    unmatched = []
    for record in student_records:
        student_no = record.get("studentNo", "")
        student_name = record.get("name", "")
        if student_no and student_no in matched_student_nos:
            continue
        if (not student_no) and student_name and student_name not in name_collision and student_name in name_slot_map:
            matched_by_name = any(
                str(sheet.cell_value(row_idx, 3)).strip() == student_name for row_idx in range(sheet.nrows)
            )
            if matched_by_name:
                continue
        if student_no not in matched_student_nos:
            unmatched.append(
                {
                    "studentNo": student_no,
                    "name": student_name or student_name_map.get(student_no, ""),
                    "slotCount": len(record.get("slots", [])),
                }
            )

    return {
        "name": class_summary["name"],
        "classId": class_summary["classId"],
        "sheetPath": class_summary["sheetPath"],
        "outputPath": class_summary["outputPath"],
        "rosterRowCount": roster_row_count,
        "matchedStudentCount": len(matched_student_nos),
        "writtenCellCount": written_cell_count,
        "unmatchedStudents": unmatched,
    }


def main():
    if len(sys.argv) not in (2, 3):
        raise SystemExit("usage: python fill_attendance_to_gradebooks.py <summary_json> [write_result_json]")

    summary_path = Path(sys.argv[1])
    write_result_path = (
        Path(sys.argv[2]) if len(sys.argv) == 3 else summary_path.with_name("attendance_anomalies_write_result.json")
    )
    summary = load_summary(summary_path)
    results = {
        "generatedAt": summary.get("generatedAt"),
        "classes": [],
    }

    for class_summary in summary.get("classes", []):
        results["classes"].append(write_class_sheet(class_summary))

    write_result_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(write_result_path)


if __name__ == "__main__":
    main()
