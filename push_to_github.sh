#!/usr/bin/env bash
set -e

# AI Manga Reader - GitHub Push Automation Script
# Usage: ./push_to_github.sh [GITHUB_USERNAME] [REPO_NAME] [PERSONAL_ACCESS_TOKEN] [BRANCH] [COMMIT_MESSAGE]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
  echo "AI Manga Reader - GitHub Push Script"
  echo "Usage: ./push_to_github.sh <username> <repo> <token> [branch] [commit_message]"
  echo "Example: ./push_to_github.sh octocat ai-manga-reader ghp_1234567890abcdef main 'My commit message'"
  echo "Options:"
  echo "  --prepare-only    Initializes git, creates commit, tunes configs, but does not push"
  exit 0
fi

PREPARE_ONLY=0
if [ "$1" = "--prepare-only" ]; then
  PREPARE_ONLY=1
  shift
fi

USERNAME="$1"
REPO="$2"
TOKEN="$3"
BRANCH="${4:-main}"
COMMIT_MSG="${5:-Update AI Manga Reader codebase}"

# Interactive fallback only if running in an interactive terminal
if [ $PREPARE_ONLY -eq 0 ]; then
  if [ -t 0 ]; then
    if [ -z "$USERNAME" ]; then
      read -r -p "Enter your GitHub username: " USERNAME
    fi
    if [ -z "$REPO" ]; then
      read -r -p "Enter your GitHub repository name (e.g. ai-manga-reader): " REPO
    fi
    if [ -z "$TOKEN" ]; then
      echo -n "Enter your GitHub Personal Access Token (PAT): "
      read -r -s TOKEN
      echo ""
    fi
  fi

  # Clean up input values (strip spaces, quotes, and full repo URLs if pasted)
  USERNAME="$(echo "$USERNAME" | tr -d '[:space:]' | sed -e 's/^https:\/\/github.com\///' -e 's/\/.*//')"
  REPO="$(echo "$REPO" | tr -d '[:space:]' | sed -e 's/^https:\/\/github.com\/[^\/]*\///' -e 's/\.git$//')"
  TOKEN="$(echo "$TOKEN" | tr -d '[:space:]')"

  if [ -z "$USERNAME" ] || [ -z "$REPO" ] || [ -z "$TOKEN" ]; then
    echo "=========================================================="
    echo "❌ Error: Username, Repository Name, and Personal Access Token (PAT) are required!"
    echo "=========================================================="
    echo "Usage:"
    echo "  ./push_to_github.sh <github_username> <repo_name> <github_token> [branch] [commit_msg]"
    echo ""
    echo "Example:"
    echo "  ./push_to_github.sh myusername ai-manga-reader ghp_xxxxxxxxxxxxxxxxxxxx main"
    echo ""
    echo "Need a GitHub Token? Generate one at:"
    echo "  https://github.com/settings/tokens/new?scopes=repo"
    echo "=========================================================="
    exit 1
  fi
fi

echo "=========================================================="
echo "    AI Manga Reader - GitHub Deployment & Push Script     "
echo "=========================================================="

echo "🚀 [1/5] Checking Git repository initialization..."
if [ ! -d ".git" ]; then
  echo "   Initializing fresh Git repository on branch '$BRANCH'..."
  git init -b "$BRANCH"
else
  echo "   Git repository is already initialized."
  git branch -M "$BRANCH" 2>/dev/null || true
fi

# Ensure user credentials exist locally in git
if [ -z "$(git config --get user.name)" ]; then
  GIT_AUTHOR_NAME="${USERNAME:-AI Manga Reader}"
  git config user.name "$GIT_AUTHOR_NAME"
fi
if [ -z "$(git config --get user.email)" ]; then
  GIT_AUTHOR_EMAIL="${USERNAME:+${USERNAME}@users.noreply.github.com}"
  GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-bot@manga-reader.local}"
  git config user.email "$GIT_AUTHOR_EMAIL"
fi

echo "📦 [2/5] Staging files according to .gitignore..."
git add -A

echo "💾 [3/5] Creating commit..."
# Check if there are changes to commit
if git diff --cached --quiet; then
  echo "   No file changes detected since last commit."
  # Check if HEAD exists (at least one commit exists)
  if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
    echo "   Creating initial commit..."
    git commit --allow-empty -m "Initial commit for AI Manga Reader"
  fi
else
  git commit -m "$COMMIT_MSG"
  echo "   Changes committed successfully: '$COMMIT_MSG'"
fi

git branch -M "$BRANCH"

echo "⚙️ [4/5] Tuning Git buffer & network settings for large files..."
git config http.postBuffer 524288000
git config http.maxRequestBuffer 500M
git config core.compression 0
git config http.version HTTP/1.1

if [ $PREPARE_ONLY -eq 1 ]; then
  echo "✅ Repository prepared and committed successfully (--prepare-only completed)."
  exit 0
fi

echo "🌐 [5/5] Configuring authenticated GitHub remote & pushing to origin/${BRANCH}..."
git remote remove origin 2>/dev/null || true

# Mask token for safe terminal logs
SAFE_REMOTE_LOG="https://${USERNAME}:***@github.com/${USERNAME}/${REPO}.git"
echo "   Target: $SAFE_REMOTE_LOG"

# Encode username and token for URL safely
ENCODED_USER=$(node -e "console.log(encodeURIComponent(process.argv[1]))" "$USERNAME" 2>/dev/null || echo "$USERNAME")
ENCODED_TOKEN=$(node -e "console.log(encodeURIComponent(process.argv[1]))" "$TOKEN" 2>/dev/null || echo "$TOKEN")
REMOTE_URL="https://${ENCODED_USER}:${ENCODED_TOKEN}@github.com/${USERNAME}/${REPO}.git"

git remote add origin "$REMOTE_URL"

# Push with force to ensure the remote branch is aligned
if git push -u origin "$BRANCH" --force; then
  echo ""
  echo "=========================================================="
  echo "🎉 SUCCESS: Project successfully pushed to GitHub!"
  echo "🔗 View your repository: https://github.com/${USERNAME}/${REPO}"
  echo "=========================================================="
  # Remove token from git config origin URL for security
  git remote set-url origin "https://github.com/${USERNAME}/${REPO}.git"
  exit 0
else
  EXIT_CODE=$?
  echo ""
  echo "=========================================================="
  echo "❌ PUSH FAILED (Exit Code: $EXIT_CODE)"
  echo "Common causes & solutions:"
  echo "1. Token permissions: Make sure your GitHub Personal Access Token (PAT)"
  echo "   has the 'repo' scope enabled (or 'Contents' Read & Write)."
  echo "   Create token here: https://github.com/settings/tokens/new?scopes=repo"
  echo "2. Repository does not exist yet: Create the repository first at:"
  echo "   https://github.com/new (Name: $REPO)"
  echo "3. Password vs Token: GitHub does NOT accept account passwords."
  echo "   You must use a Personal Access Token (starts with ghp_...)."
  echo "=========================================================="
  # Remove token from git config origin URL for security
  git remote set-url origin "https://github.com/${USERNAME}/${REPO}.git" 2>/dev/null || true
  exit $EXIT_CODE
fi
