#!/usr/bin/env python3
"""
Batch convert Avee Player .viz archives to OpenViz .ovz / JSON templates.
"""

import os
import sys
import json
import zipfile
import argparse

def convert_viz_file(viz_path, output_dir):
    filename = os.path.basename(viz_path)
    base_name = os.path.splitext(filename)[0]
    out_path = os.path.join(output_dir, f"{base_name}.ovz")

    try:
        with zipfile.ZipFile(viz_path, 'r') as zip_ref:
            file_list = zip_ref.namelist()
            json_files = [f for f in file_list if f.endswith('.json')]

            root_data = {}
            if json_files:
                with zip_ref.open(json_files[0]) as jf:
                    root_data = json.load(jf)

            ovz_template = {
                "schemaVersion": "openviz/1",
                "name": base_name,
                "author": "Avee Batch Converter",
                "canvasAspect": "16:9",
                "clearColor": [0.0, 0.0, 0.0, 1.0],
                "nodes": [],
                "postEffects": [
                    {"type": "Bloom", "threshold": 0.4, "intensity": 1.2},
                    {"type": "ChromaticAberration", "amount": 0.015}
                ],
                "sourceAveeData": root_data
            }

            with open(out_path, 'w', encoding='utf-8') as out_f:
                json.dump(ovz_template, out_f, indent=2)

            return True, None
    except Exception as e:
        return False, str(e)

def main():
    parser = argparse.ArgumentParser(description="Batch convert Avee Player .viz files to OpenViz .ovz templates.")
    parser.add_argument("input_dir", help="Directory containing .viz files")
    parser.add_argument("--output", "-o", default="./converted", help="Output directory for .ovz templates")
    args = parser.parse_args()

    if not os.path.exists(args.input_dir):
        print(f"Error: Input directory '{args.input_dir}' does not exist.")
        sys.exit(1)

    os.makedirs(args.output, exist_ok=True)

    viz_files = [os.path.join(args.input_dir, f) for f in os.listdir(args.input_dir) if f.endswith('.viz')]
    print(f"Found {len(viz_files)} .viz file(s) in {args.input_dir}")

    successful = 0
    failed = 0

    for viz in viz_files:
        ok, err = convert_viz_file(viz, args.output)
        if ok:
            successful += 1
            print(f"  [SUCCESS] {os.path.basename(viz)}")
        else:
            failed += 1
            print(f"  [FAILED] {os.path.basename(viz)}: {err}")

    print("\nConversion Statistics:")
    print(f"  Total Processed: {len(viz_files)}")
    print(f"  Successful:      {successful}")
    print(f"  Failed:          {failed}")

if __name__ == "__main__":
    main()
