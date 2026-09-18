export function WorkflowNavigation({
  section,
  onNavigate,
  commentCount = 0,
}: {
  section: string;
  onNavigate: (section: string) => void;
  commentCount?: number;
}) {
  return (
    <nav aria-label="项目流程">
      {[
        ["upload", "上传"],
        ["review", "评审"],
        ["coach", "教练"],
        ["script", "讲稿"],
        ["versions", "版本"],
      ].map(([value, label]) => (
        <button
          key={value}
          aria-label={label}
          aria-current={section === value ? "page" : undefined}
          className={section === value ? "active" : ""}
          onClick={() => onNavigate(value ?? "review")}
        >
          {label}
          {value === "review" && commentCount > 0 && (
            <span className="nav-count">{commentCount}</span>
          )}
        </button>
      ))}
    </nav>
  );
}
