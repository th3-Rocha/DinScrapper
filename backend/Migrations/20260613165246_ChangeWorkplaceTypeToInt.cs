using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class ChangeWorkplaceTypeToInt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // PostgreSQL requires an explicit USING clause to cast text → integer.
            // The value stored is always "1", "2", or "3", so the cast is safe.
            migrationBuilder.Sql(
                "ALTER TABLE \"SearchSettings\" ALTER COLUMN \"WorkplaceType\" TYPE integer USING \"WorkplaceType\"::integer;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "WorkplaceType",
                table: "SearchSettings",
                type: "text",
                nullable: false,
                oldClrType: typeof(int),
                oldType: "integer");
        }
    }
}
