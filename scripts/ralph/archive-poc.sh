#!/bin/bash
# Archive POC and Prepare for MVP
# This script archives the completed POC state and prepares fresh files for MVP development

set -e  # Exit on any error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "📦 Archiving POC and preparing for MVP..."
echo ""

# Step 1: Create archive directory
echo "1️⃣  Creating archive directory..."
mkdir -p archive/poc

# Step 2: Copy current PRD and progress to archive
echo "2️⃣  Copying current PRD and progress to archive..."
cp prd.json archive/poc/prd.json
cp progress.txt archive/poc/progress.txt

# Step 3: Extract Codebase Patterns section for new progress.txt
echo "3️⃣  Creating fresh progress.txt with preserved Codebase Patterns..."

# Extract everything from "## Codebase Patterns" until the first "---" separator
cat > progress.txt << 'PROGRESS_HEADER'
# Ralph Progress Log
# Project: AI Video Cataloger
# Branch: ralph/ai-video-cataloger-mvp-v2
# Started: $(date +%Y-%m-%d)
# Phase: MVP (User-Friendly Release)
# Previous Phase: POC (archived in archive/poc/)

PROGRESS_HEADER

# Replace the date placeholder with actual date
sed -i '' "s/\$(date +%Y-%m-%d)/$(date +%Y-%m-%d)/" progress.txt

# Extract Codebase Patterns from archived progress
echo "## Codebase Patterns" >> progress.txt
sed -n '/^## Codebase Patterns$/,/^---$/p' archive/poc/progress.txt | tail -n +2 | sed '$d' >> progress.txt
echo "" >> progress.txt
echo "---" >> progress.txt
echo "" >> progress.txt

# Step 4: Create template prd.json
echo "4️⃣  Creating template prd.json for MVP..."
cat > prd.json << 'PRD_TEMPLATE'
{
  "project": "AI Video Cataloger",
  "branchName": "ralph/ai-video-cataloger-mvp-v2",
  "description": "User-friendly MVP of the AI Video Cataloger - ready for real users",
  "userStories": [
    {
      "id": "US-028",
      "title": "YOUR FIRST MVP STORY TITLE",
      "description": "As a [user type], I want [feature] so that [benefit].",
      "acceptanceCriteria": [
        "Criterion 1",
        "Criterion 2",
        "Typecheck passes"
      ],
      "priority": 1,
      "passes": false,
      "notes": ""
    }
  ]
}
PRD_TEMPLATE

echo ""
echo "✅ Archive complete!"
echo ""
echo "📁 Files created:"
echo "   - archive/poc/prd.json     (27 completed POC stories)"
echo "   - archive/poc/progress.txt (POC learnings archived)"
echo "   - progress.txt             (fresh, with Codebase Patterns preserved)"
echo "   - prd.json                 (template ready for MVP stories)"
echo ""
echo "🏷️  Next steps:"
echo "   1. Review the changes: git diff"
echo "   2. Create git tag:     git tag -a poc-complete -m 'POC complete - 27 user stories'"
echo "   3. Commit archive:     git add -A && git commit -m 'chore: Archive POC, prepare for MVP'"
echo "   4. Create new branch:  git checkout -b ralph/ai-video-cataloger-mvp-v2"
echo "   5. Plan your MVP features and update prd.json"
echo "   6. Run Ralph loop:     ./scripts/ralph/ralph.sh --tool claude"
echo ""
