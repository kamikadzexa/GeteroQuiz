module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Score',
    {
      points: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: 'scores',
    },
  );
